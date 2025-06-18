import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Box,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Worktree } from '../../../shared/types';

interface SendInstructionDialogProps {
  open: boolean;
  onClose: () => void;
  worktrees: Worktree[];
  onSendInstruction: (instruction: string, selectedWorktrees: string[]) => Promise<void>;
}

export default function SendInstructionDialog({ open, onClose, worktrees, onSendInstruction }: SendInstructionDialogProps) {
  const [instruction, setInstruction] = useState('');
  const [selectedWorktrees, setSelectedWorktrees] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 初期状態：全てのWorkTreeを選択
  useEffect(() => {
    if (open) {
      setSelectedWorktrees(worktrees.map(wt => wt.path));
      setInstruction('');
      setError(null);
    }
  }, [open, worktrees]);

  const handleToggleWorktree = (path: string) => {
    setSelectedWorktrees(prev =>
      prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path]
    );
  };

  const handleSelectAll = () => {
    setSelectedWorktrees(worktrees.map(wt => wt.path));
  };

  const handleDeselectAll = () => {
    setSelectedWorktrees([]);
  };

  const handleSend = async () => {
    if (!instruction.trim()) {
      setError('指示を入力してください');
      return;
    }

    if (selectedWorktrees.length === 0) {
      setError('少なくとも1つのWorkTreeを選択してください');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await onSendInstruction(instruction, selectedWorktrees);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信中にエラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>WorkTreeに指示を送信</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <TextField
            label="指示内容"
            multiline
            rows={4}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            fullWidth
            variant="outlined"
            placeholder="全てのWorkTreeで実行したい指示を入力してください..."
            disabled={isLoading}
          />

          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle1">送信先のWorkTree</Typography>
              <Box>
                <Button size="small" onClick={handleSelectAll} disabled={isLoading}>
                  全選択
                </Button>
                <Button size="small" onClick={handleDeselectAll} disabled={isLoading}>
                  全解除
                </Button>
              </Box>
            </Box>

            <FormGroup>
              {worktrees.map((worktree) => (
                <FormControlLabel
                  key={worktree.path}
                  control={
                    <Checkbox
                      checked={selectedWorktrees.includes(worktree.path)}
                      onChange={() => handleToggleWorktree(worktree.path)}
                      disabled={isLoading}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body1">{worktree.branch}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {worktree.path}
                        {worktree.isMain && ' (Main)'}
                        {worktree.isCurrent && ' (Current)'}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </FormGroup>
          </Box>

          <Typography variant="caption" color="text.secondary">
            選択された {selectedWorktrees.length} / {worktrees.length} WorkTree
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          キャンセル
        </Button>
        <Button
          onClick={handleSend}
          variant="contained"
          disabled={isLoading || !instruction.trim() || selectedWorktrees.length === 0}
          startIcon={isLoading && <CircularProgress size={20} />}
        >
          送信
        </Button>
      </DialogActions>
    </Dialog>
  );
}