import { spawn, IPty } from 'node-pty';
import { EventEmitter } from 'events';
import { Session, SessionState, SessionType, Worktree } from '../../../shared/types.js';

interface InternalSession extends Session {
  process: IPty;
  output: string[];
  outputHistory: Buffer[];
  isActive: boolean;
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, InternalSession> = new Map();
  private sessionsByWorktree: Map<string, Map<SessionType, string>> = new Map();
  private waitingWithBottomBorder: Map<string, boolean> = new Map();
  private busyTimers: Map<string, NodeJS.Timeout> = new Map();
  private resizeTimers: Map<string, NodeJS.Timeout> = new Map();

  private stripAnsi(str: string): string {
    return str
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b[PX^_].*?\x1b\\/g, '')
      .replace(/\x1b\[\?[0-9;]*[hl]/g, '')
      .replace(/\x1b[>=]/g, '')
      .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')
      .replace(/\r/g, '')
      .replace(/^[0-9;]+m/gm, '')
      .replace(/[0-9]+;[0-9]+;[0-9;]+m/g, '');
  }

  public filterProblematicSequences(data: string): string {
    // Filter out OSC 11 color queries (^[]11;rgb:...)
    data = data.replace(/\x1b\]11;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
    
    // Filter out cursor position reports (^[[<row>;<col>R)
    data = data.replace(/\x1b\[\d+;\d+R/g, '');
    
    // Filter out device status reports
    data = data.replace(/\x1b\[6n/g, ''); // CPR request
    data = data.replace(/\x1b\[5n/g, ''); // DSR request
    data = data.replace(/\x1b\[\?1;2c/g, ''); // DA response
    
    // Filter out other terminal queries
    data = data.replace(/\x1b\[>c/g, ''); // Secondary DA
    data = data.replace(/\x1b\[c/g, ''); // Primary DA
    
    return data;
  }

  private includesPromptBoxBottomBorder(str: string): boolean {
    const patterns = [
      /└─+┘/,
      /╰─+╯/,
      /┗━+┛/,
      /╚═+╝/,
    ];
    return patterns.some(pattern => pattern.test(str));
  }

  private detectSessionState(
    cleanData: string,
    currentState: SessionState,
    sessionId: string,
  ): SessionState {
    const hasBottomBorder = this.includesPromptBoxBottomBorder(cleanData);
    const hasWaitingPrompt =
      cleanData.includes('│ Do you want') ||
      cleanData.includes('│ Would you like') ||
      cleanData.includes('Do you want') ||
      cleanData.includes('Would you like') ||
      cleanData.includes('Continue?') ||
      cleanData.includes('Proceed?') ||
      cleanData.includes('(y/n)') ||
      cleanData.includes('(Y/n)') ||
      cleanData.includes('[y/N]') ||
      cleanData.includes('YES') ||
      cleanData.includes('NO') ||
      cleanData.includes('[Y/n]') ||
      cleanData.includes('1. Yes') ||
      cleanData.includes('2. No');
    const wasWaitingWithBottomBorder =
      this.waitingWithBottomBorder.get(sessionId) || false;
    const hasEscToInterrupt = cleanData
      .toLowerCase()
      .includes('esc to interrupt');

    let newState = currentState;

    if (hasWaitingPrompt) {
      console.log('[SessionManager] Detected waiting prompt in output:', cleanData.substring(0, 100) + '...');
      newState = 'waiting_input';
      if (hasBottomBorder) {
        this.waitingWithBottomBorder.set(sessionId, true);
      } else {
        this.waitingWithBottomBorder.set(sessionId, false);
      }
      const existingTimer = this.busyTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.busyTimers.delete(sessionId);
      }
    } else if (
      currentState === 'waiting_input' &&
      hasBottomBorder &&
      !hasWaitingPrompt &&
      !wasWaitingWithBottomBorder
    ) {
      newState = 'waiting_input';
      this.waitingWithBottomBorder.set(sessionId, true);
      const existingTimer = this.busyTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.busyTimers.delete(sessionId);
      }
    } else if (hasEscToInterrupt) {
      newState = 'busy';
      this.waitingWithBottomBorder.set(sessionId, false);
      const existingTimer = this.busyTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.busyTimers.delete(sessionId);
      }
    } else if (currentState === 'busy' && !hasEscToInterrupt) {
      if (!this.busyTimers.has(sessionId)) {
        const timer = setTimeout(() => {
          const session = this.sessions.get(sessionId);
          if (session && session.state === 'busy' && session.process) {
            console.log(`[SessionManager] Auto-transitioning session ${sessionId} from busy to idle`);
            session.state = 'idle';
            this.emit('sessionStateChanged', session);
          } else {
            console.log(`[SessionManager] Skipping auto-transition for session ${sessionId} - invalid state or process`);
          }
          this.busyTimers.delete(sessionId);
        }, 500);
        this.busyTimers.set(sessionId, timer);
      }
      newState = 'busy';
    }

    return newState;
  }

  createSession(worktreePath: string, sessionType: SessionType = 'claude', parameters?: string[]): Session {
    // Check if a session of this type already exists for this worktree
    const worktreeSessions = this.sessionsByWorktree.get(worktreePath);
    if (worktreeSessions) {
      const existingSessionId = worktreeSessions.get(sessionType);
      if (existingSessionId) {
        const existing = this.sessions.get(existingSessionId);
        if (existing && existing.process) {
          try {
            // Check if process is still alive by trying to write an empty string
            existing.process.write('');
            // Return existing active session
            console.log(`Reusing existing ${sessionType} session ${existing.id} for worktree ${worktreePath}`);
            return {
              id: existing.id,
              worktreePath: existing.worktreePath,
              state: existing.state,
              lastActivity: existing.lastActivity,
              type: existing.type,
            };
          } catch (error) {
            // Process is dead, clean it up
            console.log(`Cleaning up dead ${sessionType} session ${existing.id} for worktree ${worktreePath}`);
            this.destroySessionById(existingSessionId);
          }
        }
      }
    }

    const id = `session-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    let command: string;
    let args: string[] = [];

    if (sessionType === 'terminal') {
      // Check if this is a Claude Code terminal
      if (parameters && parameters.length > 0) {
        // Claude Code terminal with parameters
        command = 'claude';
        args = parameters;
      } else {
        // Regular terminal - use the user's default shell
        command = process.env.SHELL || '/bin/sh';
        args = ['-l']; // Login shell
      }
    } else {
      // Claude Code session
      command = 'claude';
      // Use provided parameters if available, otherwise fall back to environment variable
      if (parameters && parameters.length > 0) {
        args = parameters;
      } else {
        args = process.env['CC_CLAUDE_ARGS']
          ? process.env['CC_CLAUDE_ARGS'].split(' ')
          : [];
      }
    }

    // Create environment with terminal settings that prevent escape sequence queries
    const env = {
      ...process.env,
      // Prevent color queries
      COLORTERM: 'truecolor',
      // Set TERM to a well-known value that doesn't trigger queries
      TERM: 'xterm-256color',
      // Disable terminal reporting features
      TERM_PROGRAM: 'claude-code-crew',
    } as { [key: string]: string };

    const ptyProcess = spawn(command, args, {
      name: 'xterm-color',
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      cwd: worktreePath,
      env,
    });

    const session: InternalSession = {
      id,
      worktreePath,
      process: ptyProcess,
      state: sessionType === 'terminal' ? 'idle' : 'busy',
      output: [],
      outputHistory: [],
      lastActivity: new Date(),
      isActive: false,
      type: sessionType,
    };

    this.setupBackgroundHandler(session, sessionType);
    this.sessions.set(session.id, session);
    
    // Track session by worktree and type
    if (!this.sessionsByWorktree.has(worktreePath)) {
      this.sessionsByWorktree.set(worktreePath, new Map());
    }
    this.sessionsByWorktree.get(worktreePath)!.set(sessionType, session.id);
    
    this.emit('sessionCreated', session);

    return {
      id: session.id,
      worktreePath: session.worktreePath,
      state: session.state,
      lastActivity: session.lastActivity,
      type: session.type,
    };
  }

  private setupBackgroundHandler(session: InternalSession, sessionType: SessionType = 'claude'): void {
    session.process.onData((data: string) => {
      const buffer = Buffer.from(data, 'utf8');
      session.outputHistory.push(buffer);

      const MAX_HISTORY_SIZE = 10 * 1024 * 1024;
      let totalSize = session.outputHistory.reduce(
        (sum, buf) => sum + buf.length,
        0,
      );
      while (totalSize > MAX_HISTORY_SIZE && session.outputHistory.length > 0) {
        const removed = session.outputHistory.shift();
        if (removed) {
          totalSize -= removed.length;
        }
      }

      session.output.push(data);
      if (session.output.length > 100) {
        session.output.shift();
      }

      session.lastActivity = new Date();

      const cleanData = this.stripAnsi(data);

      // Always emit sessionData first, regardless of content
      if (session.isActive) {
        // Filter out problematic escape sequences before sending to client
        const filteredData = this.filterProblematicSequences(data);
        this.emit('sessionData', session, filteredData);
      }

      // Skip further processing for empty content
      if (!cleanData.trim()) {
        return;
      }

      // Only detect session state for Claude sessions
      if (sessionType === 'claude') {
        const oldState = session.state;
        const newState = this.detectSessionState(
          cleanData,
          oldState,
          session.id,
        );

        if (newState !== oldState) {
          console.log(`[SessionManager] State transition for ${session.id}: ${oldState} -> ${newState}`);
          session.state = newState;
          this.emit('sessionStateChanged', session);
        }
      }
    });

    session.process.onExit(() => {
      session.state = 'idle';
      this.emit('sessionStateChanged', session);
      this.destroySessionById(session.id);
      this.emit('sessionExit', session);
    });
  }

  getSession(worktreePath: string, sessionType?: SessionType): InternalSession | undefined {
    if (sessionType) {
      const worktreeSessions = this.sessionsByWorktree.get(worktreePath);
      if (worktreeSessions) {
        const sessionId = worktreeSessions.get(sessionType);
        if (sessionId) {
          return this.sessions.get(sessionId);
        }
      }
      return undefined;
    }
    
    // Legacy: return first session for worktree
    const worktreeSessions = this.sessionsByWorktree.get(worktreePath);
    if (worktreeSessions && worktreeSessions.size > 0) {
      const sessionId = Array.from(worktreeSessions.values())[0];
      return this.sessions.get(sessionId);
    }
    return undefined;
  }

  getSessionById(sessionId: string): InternalSession | undefined {
    return this.sessions.get(sessionId);
  }

  setSessionActive(worktreePath: string, active: boolean): void {
    // Set all sessions for this worktree
    const worktreeSessions = this.sessionsByWorktree.get(worktreePath);
    if (worktreeSessions) {
      for (const sessionId of worktreeSessions.values()) {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.isActive = active;

          if (active && session.outputHistory.length > 0) {
            console.log(`Restoring session ${session.id} with ${session.outputHistory.length} history items`);
            this.emit('sessionRestore', session);
          } else if (active) {
            console.log(`Session ${session.id} activated but no history to restore`);
          }
        }
      }
    }
  }

  writeToSession(sessionId: string, data: string): void {
    const session = this.getSessionById(sessionId);
    if (session) {
      session.process.write(data);
    }
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.getSessionById(sessionId);
    if (!session) {
      console.warn(`[SessionManager] Resize requested for non-existent session: ${sessionId}`);
      return;
    }

    // Validate dimensions
    if (cols < 1 || rows < 1 || cols > 1000 || rows > 1000) {
      console.warn(`[SessionManager] Invalid resize dimensions for session ${sessionId}: ${cols}x${rows}`);
      return;
    }

    // Clear any existing resize timer for this session
    const existingTimer = this.resizeTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Debounce resize operations to prevent rapid consecutive resizes
    const timer = setTimeout(() => {
      try {
        if (session.process) {
          console.log(`[SessionManager] Resizing session ${sessionId} to ${cols}x${rows}`);
          session.process.resize(cols, rows);
        } else {
          console.warn(`[SessionManager] Cannot resize session with no process: ${sessionId}`);
        }
      } catch (error) {
        console.error(`[SessionManager] Failed to resize session ${sessionId}:`, error);
      } finally {
        this.resizeTimers.delete(sessionId);
      }
    }, 50); // 50ms debounce

    this.resizeTimers.set(sessionId, timer);
  }

  destroySessionById(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.process.kill();
      } catch (_error) {
        // Process might already be dead
      }
      
      // Clear busy timer
      const busyTimer = this.busyTimers.get(sessionId);
      if (busyTimer) {
        clearTimeout(busyTimer);
        this.busyTimers.delete(sessionId);
      }
      
      // Clear resize timer
      const resizeTimer = this.resizeTimers.get(sessionId);
      if (resizeTimer) {
        clearTimeout(resizeTimer);
        this.resizeTimers.delete(sessionId);
      }
      
      // Remove from worktree tracking
      const worktreeSessions = this.sessionsByWorktree.get(session.worktreePath);
      if (worktreeSessions) {
        worktreeSessions.delete(session.type!);
        if (worktreeSessions.size === 0) {
          this.sessionsByWorktree.delete(session.worktreePath);
        }
      }
      
      this.sessions.delete(sessionId);
      this.waitingWithBottomBorder.delete(session.id);
      this.emit('sessionDestroyed', session);
    }
  }

  destroySession(worktreePath: string): void {
    // Destroy all sessions for this worktree
    const worktreeSessions = this.sessionsByWorktree.get(worktreePath);
    if (worktreeSessions) {
      for (const sessionId of worktreeSessions.values()) {
        this.destroySessionById(sessionId);
      }
    }
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      worktreePath: session.worktreePath,
      state: session.state,
      lastActivity: session.lastActivity,
      type: session.type,
    }));
  }

  destroy(): void {
    // Clear all timers first
    for (const timer of this.busyTimers.values()) {
      clearTimeout(timer);
    }
    this.busyTimers.clear();
    
    for (const timer of this.resizeTimers.values()) {
      clearTimeout(timer);
    }
    this.resizeTimers.clear();
    
    // Then destroy all sessions
    for (const sessionId of this.sessions.keys()) {
      this.destroySessionById(sessionId);
    }
  }
}