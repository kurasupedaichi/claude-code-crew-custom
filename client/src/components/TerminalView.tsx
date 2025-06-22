import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Socket } from 'socket.io-client';
import { Session } from '../../../shared/types';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  session: Session;
  socket: Socket;
}

const TerminalView: React.FC<TerminalViewProps> = ({ session, socket }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isResizingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Clean up existing terminal if session changes
    if (xtermRef.current) {
      console.log('[TerminalView] Cleaning up existing terminal for session:', session.id);
      xtermRef.current.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    }

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        black: '#0a0a0a',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
    });

    // Add addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    // Open terminal in the DOM
    term.open(terminalRef.current);
    fitAddon.fit();

    // Store references
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle terminal input
    term.onData((data) => {
      socket.emit('session:input', { sessionId: session.id, input: data });
    });

    // Handle terminal resize - coordinate with backend
    term.onResize(({ cols, rows }) => {
      if (!isResizingRef.current) {
        socket.emit('session:resize', { sessionId: session.id, cols, rows });
      }
    });

    // Debounced resize handler with proper synchronization
    const handleResize = () => {
      // Clear any existing timeout
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      // Set resize flag to prevent redundant backend calls
      isResizingRef.current = true;

      // Debounce the actual resize operation
      resizeTimeoutRef.current = setTimeout(() => {
        if (fitAddonRef.current && xtermRef.current) {
          try {
            // Store current scroll position
            const scrollTop = xtermRef.current.element?.querySelector('.xterm-viewport')?.scrollTop || 0;
            
            // Perform the fit operation
            fitAddonRef.current.fit();
            
            // Get new dimensions after fit
            const cols = xtermRef.current.cols;
            const rows = xtermRef.current.rows;
            
            // Send resize to backend with new dimensions
            socket.emit('session:resize', { sessionId: session.id, cols, rows });
            
            // Restore scroll position after a brief delay to allow for terminal update
            setTimeout(() => {
              const viewport = xtermRef.current?.element?.querySelector('.xterm-viewport');
              if (viewport && scrollTop > 0) {
                viewport.scrollTop = Math.min(scrollTop, viewport.scrollHeight - viewport.clientHeight);
              }
              // Clear resize flag
              isResizingRef.current = false;
            }, 50);
          } catch (error) {
            console.error('[TerminalView] Error during resize:', error);
            isResizingRef.current = false;
          }
        } else {
          isResizingRef.current = false;
        }
      }, 150); // 150ms debounce delay
    };

    window.addEventListener('resize', handleResize);

    // Socket event handlers - create session-specific handlers to avoid closure issues
    const currentSessionId = session.id;
    const currentWorktreePath = session.worktreePath;
    
    const handleOutput = ({ sessionId, data }: { sessionId: string; data: string }) => {
      if (sessionId === currentSessionId && xtermRef.current) {
        xtermRef.current.write(data);
        // Auto-scroll to bottom on new output
        xtermRef.current.scrollToBottom();
      }
    };

    const handleRestore = ({ sessionId, history }: { sessionId: string; history: string }) => {
      if (sessionId === currentSessionId && xtermRef.current) {
        console.log('[TerminalView] Restoring history for session:', currentSessionId, 'worktree:', currentWorktreePath);
        xtermRef.current.clear();
        xtermRef.current.write(history);
        // Scroll to bottom after restoring history
        xtermRef.current.scrollToBottom();
      }
    };

    socket.on('session:output', handleOutput);
    socket.on('session:restore', handleRestore);

    // Request session restore if reconnecting
    // Send both sessionId and worktreePath/type for better session recovery
    console.log('[TerminalView] Requesting restore for session:', session.id, 'worktree:', session.worktreePath);
    socket.emit('session:restore', {
      sessionId: session.id,
      worktreePath: session.worktreePath,
      sessionType: session.type
    });

    // Cleanup
    return () => {
      console.log('[TerminalView] Cleaning up listeners for session:', currentSessionId);
      window.removeEventListener('resize', handleResize);
      socket.off('session:output', handleOutput);
      socket.off('session:restore', handleRestore);
      
      // Clear resize timeout
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
      
      // Reset resize flag
      isResizingRef.current = false;
      
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      }
    };
  }, [session.id, session.worktreePath, session.type, socket]);

  // Handle session changes
  useEffect(() => {
    // Debounce the fit operation when session changes
    const timeout = setTimeout(() => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
          // Scroll to bottom when session changes (e.g., when switching worktrees)
          xtermRef.current.scrollToBottom();
          // Focus the terminal when the tab becomes active
          xtermRef.current.focus();
        } catch (error) {
          console.error('[TerminalView] Error during session change fit:', error);
        }
      }
    }, 50);

    return () => clearTimeout(timeout);
  }, [session]);

  // Scroll to bottom when worktree path changes
  useEffect(() => {
    if (xtermRef.current && session.worktreePath) {
      xtermRef.current.scrollToBottom();
    }
  }, [session.worktreePath]);

  return (
    <Box
      ref={terminalRef}
      sx={{
        flexGrow: 1,
        height: '100%',
        padding: 1,
        backgroundColor: '#0a0a0a',
        '& .xterm': {
          padding: '10px',
        },
        '& .xterm-viewport': {
          backgroundColor: 'transparent !important',
        },
      }}
    />
  );
};

export default TerminalView;