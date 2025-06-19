# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web-based Git worktree management tool for Claude Code sessions. It allows users to manage multiple Claude Code sessions across different Git worktrees through a browser interface.

## Architecture

### Monorepo Structure
- **`server/`**: Node.js backend with Express, Socket.io, and node-pty for terminal sessions
- **`client/`**: React frontend with TypeScript, Material-UI, and xterm.js for terminal emulation
- **`shared/`**: Common TypeScript types used by both client and server
- **`bin/`**: CLI entry point for global installation

### Key Components
- **SessionManager**: Manages Claude Code and terminal sessions across worktrees
- **WorktreeService**: Handles Git worktree operations (create, delete, merge)
- **WebSocket Server**: Real-time communication for terminal streams and session state
- **Terminal Emulation**: xterm.js frontend connected to node-pty backend

## Common Development Commands

### Setup and Installation
```bash
pnpm install                    # Install all dependencies
```

### Development
```bash
./start.sh                      # Start development environment (client + server)
pnpm dev                        # Alternative: build and start production mode
```

### Building
```bash
pnpm run build                  # Build both client and server
pnpm run copy-client            # Copy client dist to server public folder
```

### Testing
```bash
pnpm test                       # Run tests in watch mode
pnpm run test:run              # Run tests once
pnpm run test:coverage         # Run tests with coverage
```

### Type Checking
```bash
pnpm run typecheck             # Check TypeScript types for all packages
```

### Individual Package Commands
```bash
# Client-specific (run from client/ directory)
cd client && pnpm dev          # Start Vite dev server
cd client && pnpm build        # Build client only

# Server-specific (run from server/ directory)  
cd server && pnpm dev          # Start server in watch mode with tsx
cd server && pnpm build        # Build server only
```

## Development Workflow

1. **Start Development**: Use `./start.sh` to run both client and server in development mode
2. **Frontend Development**: Client runs on http://localhost:3000 (Vite dev server)
3. **Backend Development**: Server runs on http://localhost:3001 (Express server)
4. **Production Build**: Builds client into `client/dist/` and copies to `server/dist/public/`

## Key Patterns

### Session Management
- Sessions are identified by worktree path and can be Claude Code or terminal sessions
- Session state is tracked (`idle`, `busy`, `waiting_input`) and synchronized via WebSocket
- Terminal history is preserved when switching between sessions

### WebSocket Communication
- Real-time terminal I/O streaming
- Session state synchronization
- Worktree list updates
- Event types defined in `shared/types.ts`

### Git Worktree Integration
- Automatic detection of Git worktrees in the working directory
- UI for creating new worktrees from branches
- Merge and delete operations with Git safety checks

## Environment Variables

- `PORT`: Server port (default: 3001)
- `WORK_DIR`: Git repository working directory
- `CC_CLAUDE_ARGS`: Additional arguments for Claude Code sessions
- `NODE_ENV`: Environment mode (development/production)

## Testing

- **Client**: Vitest + React Testing Library + Playwright
- **Server**: Vitest + Supertest for API testing
- **Integration**: WebSocket and session management tests

## Dependencies

### Runtime
- `express`: Web server framework
- `socket.io`: WebSocket communication
- `node-pty-prebuilt-multiarch`: Terminal emulation
- `react`: Frontend framework
- `@mui/material`: UI components
- `@xterm/xterm`: Terminal emulator frontend

### Development
- `typescript`: Type checking
- `vite`: Frontend build tool
- `vitest`: Testing framework
- `tsx`: TypeScript execution for server development