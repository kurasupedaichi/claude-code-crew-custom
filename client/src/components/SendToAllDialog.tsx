import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Checkbox,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Alert,
} from '@mui/material';
import {
  Send,
  FolderOpen,
  Circle,
} from '@mui/icons-material';
import { Worktree, Session } from '../../../shared/types';

interface SendToAllDialogProps {
  open: boolean;
  onClose: () => void;
  worktrees: Worktree[];
  onSend: (message: string, selectedWorktrees: string[]) => void;
}

const SendToAllDialog: React.FC<SendToAllDialogProps> = ({
  open,
  onClose,
  worktrees,
  onSend,
}) => {
  const [message, setMessage] = useState('');
  const [selectedWorktrees, setSelectedWorktrees] = useState<string[]>([]);

  // Filter worktrees that have active Claude sessions
  const activeWorktrees = worktrees.filter(
    (wt) => wt.session && wt.session.type === 'claude' && wt.session.state !== 'closed'
  );

  const handleToggleWorktree = (worktreePath: string) => {
    setSelectedWorktrees((prev) =>
      prev.includes(worktreePath)
        ? prev.filter((path) => path !== worktreePath)
        : [...prev, worktreePath]
    );
  };

  const handleSelectAll = () => {
    if (selectedWorktrees.length === activeWorktrees.length) {
      setSelectedWorktrees([]);
    } else {
      setSelectedWorktrees(activeWorktrees.map((wt) => wt.path));
    }
  };

  const handleSend = () => {
    if (message.trim() && selectedWorktrees.length > 0) {
      onSend(message.trim(), selectedWorktrees);
      setMessage('');
      setSelectedWorktrees([]);
      onClose();
    }
  };

  const getSessionStateColor = (state: string) => {
    switch (state) {
      case 'busy':
        return 'warning';
      case 'waiting_input':
        return 'success';
      case 'idle':
        return 'info';
      default:
        return 'default';
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>WorkTreeに指示を送信</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Alert severity="info">
            選択したWorkTreeのClaudeセッションに同じ指示を送信します。
            送信後、自動的にEnterキーが送信されます。
          </Alert>

          <TextField
            autoFocus
            multiline
            rows={4}
            fullWidth
            label="送信する指示"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="すべてのWorkTreeに送信する指示を入力してください..."
            variant="outlined"
          />

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle1">
                送信先のWorkTreeを選択 ({selectedWorktrees.length}/{activeWorktrees.length})
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedWorktrees.length === activeWorktrees.length && activeWorktrees.length > 0}
                    indeterminate={selectedWorktrees.length > 0 && selectedWorktrees.length < activeWorktrees.length}
                    onChange={handleSelectAll}
                  />
                }
                label="すべて選択"
              />
            </Box>

            {activeWorktrees.length === 0 ? (
              <Alert severity="warning">
                アクティブなClaudeセッションを持つWorkTreeがありません。
              </Alert>
            ) : (
              <List sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, maxHeight: 300, overflow: 'auto' }}>
                {activeWorktrees.map((worktree) => (
                  <ListItem
                    key={worktree.path}
                    button
                    onClick={() => handleToggleWorktree(worktree.path)}
                    selected={selectedWorktrees.includes(worktree.path)}
                  >
                    <ListItemIcon>
                      <Checkbox
                        edge="start"
                        checked={selectedWorktrees.includes(worktree.path)}
                        tabIndex={-1}
                        disableRipple
                      />
                    </ListItemIcon>
                    <ListItemIcon>
                      <FolderOpen />
                    </ListItemIcon>
                    <ListItemText
                      primary={worktree.name}
                      secondary={worktree.path}
                    />
                    {worktree.session && (
                      <Circle
                        sx={{ ml: 1 }}
                        color={getSessionStateColor(worktree.session.state)}
                        fontSize="small"
                      />
                    )}
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button
          onClick={handleSend}
          variant="contained"
          startIcon={<Send />}
          disabled={!message.trim() || selectedWorktrees.length === 0}
        >
          送信
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SendToAllDialog;