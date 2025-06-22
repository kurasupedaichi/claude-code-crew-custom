import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Socket } from 'socket.io-client';
import { Session } from '../../../shared/types';
import '@xterm/xterm/css/xterm.css';

interface PersistentTerminalViewProps {
  session: Session;
  socket: Socket;
  isVisible: boolean;
}

const PersistentTerminalView: React.FC<PersistentTerminalViewProps> = ({ 
  session, 
  socket, 
  isVisible 
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize terminal only once
  useEffect(() => {
    if (!terminalRef.current || isInitialized) return;

    console.log('[PersistentTerminalView] Initializing terminal for session:', session.id);

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace',
      // Disable various terminal features that can cause escape sequences
      // @ts-ignore - reportFocus might not be in the type definitions
      reportFocus: false,
      allowProposedApi: true,
      // Disable mouse tracking which can cause escape sequences
      // @ts-ignore - These options might not be in the type definitions
      mouseReportingMode: 'none',
      // Disable bracketed paste mode
      // @ts-ignore
      bracketedPasteMode: false,
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
    setIsInitialized(true);

    // Handle terminal input
    let isReady = false;
    // Add a small delay before accepting input to prevent initialization sequences
    setTimeout(() => {
      isReady = true;
    }, 200);
    
    term.onData((data) => {
      // Only send data if terminal is ready (prevents focus-related escape sequences)
      if (isReady) {
        socket.emit('session:input', { sessionId: session.id, input: data });
      }
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      socket.emit('session:resize', { sessionId: session.id, cols, rows });
    });

    // Cleanup only when component unmounts
    return () => {
      console.log('[PersistentTerminalView] Disposing terminal for session:', session.id);
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      }
    };
  }, [session.id, isInitialized]);

  // Handle socket events
  useEffect(() => {
    if (!isInitialized || !socket) return;

    const currentSessionId = session.id;
    
    const handleOutput = ({ sessionId, data }: { sessionId: string; data: string }) => {
      if (sessionId === currentSessionId && xtermRef.current) {
        xtermRef.current.write(data);
        if (isVisible) {
          xtermRef.current.scrollToBottom();
        }
      }
    };

    const handleRestore = ({ sessionId, history }: { sessionId: string; history: string }) => {
      if (sessionId === currentSessionId && xtermRef.current) {
        console.log('[PersistentTerminalView] Restoring history for session:', currentSessionId);
        xtermRef.current.clear();
        xtermRef.current.write(history);
        if (isVisible) {
          xtermRef.current.scrollToBottom();
        }
      }
    };

    socket.on('session:output', handleOutput);
    socket.on('session:restore', handleRestore);

    // Request session restore
    console.log('[PersistentTerminalView] Requesting restore for session:', session.id);
    socket.emit('session:restore', {
      sessionId: session.id,
      worktreePath: session.worktreePath,
      sessionType: session.type
    });

    return () => {
      socket.off('session:output', handleOutput);
      socket.off('session:restore', handleRestore);
    };
  }, [session.id, session.worktreePath, session.type, socket, isInitialized, isVisible]);

  // Handle visibility changes
  useEffect(() => {
    if (!xtermRef.current || !fitAddonRef.current) return;

    if (isVisible) {
      // Fit and focus when becoming visible
      fitAddonRef.current.fit();
      
      // Add a small delay before focusing to ensure the terminal is fully ready
      // This prevents focus-related escape sequences from being sent as input
      const focusTimeout = setTimeout(() => {
        if (xtermRef.current && isVisible) {
          xtermRef.current.focus();
          xtermRef.current.scrollToBottom();
        }
      }, 100);
      
      return () => clearTimeout(focusTimeout);
    }
  }, [isVisible]);

  // Handle window resize
  useEffect(() => {
    if (!isVisible || !fitAddonRef.current) return;

    const handleResize = () => {
      if (fitAddonRef.current && isVisible) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isVisible]);

  return (
    <Box
      ref={terminalRef}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? 'visible' : 'hidden',
        transition: 'opacity 0.2s ease-in-out, visibility 0.2s ease-in-out',
        display: 'flex',
        flexGrow: 1,
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

export default PersistentTerminalView;