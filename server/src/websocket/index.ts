import { Server, Socket } from 'socket.io';
import { SessionManager } from '../services/sessionManager.js';
import { WorktreeService } from '../services/worktreeService.js';
import { Session, SessionType, Worktree } from '../../../shared/types.js';

// Track which session each client is currently viewing
const clientSessions = new Map<string, string>(); // socketId -> sessionId

export function setupWebSocket(io: Server, sessionManager: SessionManager) {
  const worktreeService = new WorktreeService(process.env.WORK_DIR);

  // Update worktrees with session info
  const getWorktreesWithSessions = (): Worktree[] => {
    const worktrees = worktreeService.getWorktrees();
    const sessions = sessionManager.getAllSessions();
    
    console.log(`[WebSocket] Getting worktrees with sessions: ${worktrees.length} worktrees, ${sessions.length} sessions`);
    
    return worktrees.map(worktree => {
      const session = sessions.find(s => s.worktreePath === worktree.path);
      return {
        ...worktree,
        session: session || undefined,
      };
    });
  };

  // Session manager event handlers
  sessionManager.on('sessionCreated', (session: Session) => {
    io.emit('session:created', session);
    io.emit('worktrees:updated', getWorktreesWithSessions());
  });

  sessionManager.on('sessionData', (session: Session, data: string) => {
    // Only send output to clients currently viewing this session
    for (const [socketId, currentSessionId] of clientSessions.entries()) {
      if (currentSessionId === session.id) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('session:output', { sessionId: session.id, data });
        }
      }
    }
  });

  sessionManager.on('sessionStateChanged', (session: Session) => {
    io.emit('session:stateChanged', session);
    io.emit('worktrees:updated', getWorktreesWithSessions());
  });

  sessionManager.on('sessionDestroyed', (session: Session) => {
    io.emit('session:destroyed', session.id);
    io.emit('worktrees:updated', getWorktreesWithSessions());
  });

  sessionManager.on('sessionRestore', (session: any) => {
    if (session.outputHistory && session.outputHistory.length > 0) {
      let history = session.outputHistory
        .map((buf: Buffer) => buf.toString('utf8'))
        .join('');
      
      // Filter out problematic escape sequences from history
      history = sessionManager.filterProblematicSequences(history);
      
      console.log(`Sending restore data for session ${session.id}, history length: ${history.length} characters`);
      
      // Only send restore data to clients currently viewing this session
      for (const [socketId, currentSessionId] of clientSessions.entries()) {
        if (currentSessionId === session.id) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit('session:restore', { sessionId: session.id, history });
          }
        }
      }
    } else {
      console.log(`No history available for session ${session.id}`);
    }
  });

  // Socket connection handler
  io.on('connection', (socket: Socket) => {
    console.log('Client connected:', socket.id);

    // Send initial data
    socket.emit('worktrees:updated', getWorktreesWithSessions());
    
    // Send all existing sessions
    const allSessions = sessionManager.getAllSessions();
    socket.emit('sessions:list', allSessions);

    // Handle session creation
    socket.on('session:create', (worktreePath: string, sessionType?: SessionType, parameters?: string[]) => {
      try {
        const session = sessionManager.createSession(worktreePath, sessionType, parameters);
        sessionManager.setSessionActive(worktreePath, true);
        // Track this client as viewing the created session
        clientSessions.set(socket.id, session.id);
      } catch (error) {
        console.error('Failed to create session:', error);
        socket.emit('error', { 
          message: error instanceof Error ? error.message : 'Failed to create session' 
        });
      }
    });

    // Handle session input
    socket.on('session:input', ({ sessionId, input }) => {
      try {
        sessionManager.writeToSession(sessionId, input);
      } catch (error) {
        console.error('Failed to write to session:', error);
      }
    });

    // Handle session resize
    socket.on('session:resize', ({ sessionId, cols, rows }) => {
      try {
        sessionManager.resizeSession(sessionId, cols, rows);
      } catch (error) {
        console.error('Failed to resize session:', error);
      }
    });

    // Handle client-requested session restore
    socket.on('session:restore', (data: string | { sessionId?: string; worktreePath?: string; sessionType?: SessionType }) => {
      try {
        let session: any;
        
        // Support both legacy (sessionId only) and new format
        if (typeof data === 'string') {
          // Legacy format: just sessionId
          session = sessionManager.getSessionById(data);
        } else if (data.sessionId) {
          // Try to find by sessionId first
          session = sessionManager.getSessionById(data.sessionId);
        } else if (data.worktreePath && data.sessionType) {
          // Find by worktreePath and sessionType
          session = sessionManager.getSession(data.worktreePath, data.sessionType);
        }
        
        if (session) {
          // Track this client as viewing the restored session
          clientSessions.set(socket.id, session.id);
          
          if (session.outputHistory && session.outputHistory.length > 0) {
            let history = session.outputHistory
              .map((buf: Buffer) => buf.toString('utf8'))
              .join('');
            
            // Filter out problematic escape sequences from history
            history = sessionManager.filterProblematicSequences(history);
            
            console.log(`Restoring session ${session.id} with ${history.length} characters of history`);
            socket.emit('session:restore', { sessionId: session.id, history });
          } else {
            console.log(`No history available for session ${session.id}`);
          }
        } else {
          console.log(`Session not found for restore request:`, data);
        }
      } catch (error) {
        console.error('Failed to restore session:', error);
      }
    });

    // Handle session activation (switching between existing sessions)
    socket.on('session:setActive', (worktreePath: string) => {
      try {
        const sessions = sessionManager.getAllSessions();
        const targetSession = sessions.find(s => s.worktreePath === worktreePath);
        
        if (targetSession) {
          // Track this client as viewing the target session
          clientSessions.set(socket.id, targetSession.id);
          
          // Check if any client is still viewing other sessions
          const activeSessionIds = new Set(clientSessions.values());
          
          // Activate the target session
          sessionManager.setSessionActive(worktreePath, true);
          
          console.log(`Client ${socket.id} now viewing session for worktree: ${worktreePath}`);
        }
      } catch (error) {
        console.error('Failed to set session active:', error);
        socket.emit('error', { 
          message: error instanceof Error ? error.message : 'Failed to activate session' 
        });
      }
    });

    // Handle tab switching to update client tracking
    socket.on('session:switchTab', ({ worktreePath, sessionType }: { worktreePath: string, sessionType: SessionType }) => {
      try {
        const session = sessionManager.getSession(worktreePath, sessionType);
        
        if (session) {
          // Update client tracking to the new session
          clientSessions.set(socket.id, session.id);
          console.log(`Client ${socket.id} switched to ${sessionType} session for worktree: ${worktreePath}`);
          
          // Send acknowledgment with session info
          socket.emit('session:switchTab:ack', { 
            sessionId: session.id, 
            sessionType: session.type,
            worktreePath: session.worktreePath 
          });
        }
      } catch (error) {
        console.error('Failed to switch tab:', error);
        socket.emit('error', {
          message: error instanceof Error ? error.message : 'Failed to switch tab'
        });
      }
    });

    // Handle session destruction
    socket.on('session:destroy', (sessionId: string) => {
      try {
        sessionManager.destroySessionById(sessionId);
      } catch (error) {
        console.error('Failed to destroy session:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      // Remove client from session tracking
      clientSessions.delete(socket.id);
      
      // Optionally deactivate sessions when no clients are viewing them
      // This can be implemented later if needed for resource management
    });
  });

  // Cleanup on server shutdown
  process.on('SIGINT', () => {
    sessionManager.destroy();
    process.exit();
  });

  process.on('SIGTERM', () => {
    sessionManager.destroy();
    process.exit();
  });
}