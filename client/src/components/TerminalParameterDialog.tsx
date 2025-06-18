import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Box,
  Typography,
  Chip,
} from '@mui/material';
import { CheckCircleOutline } from '@mui/icons-material';

interface TerminalParameter {
  label: string;
  value: string;
  description: string;
}

interface TerminalParameterDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (parameters: string[]) => void;
}

const TERMINAL_PARAMETERS: TerminalParameter[] = [
  {
    label: 'Default',
    value: '',
    description: 'Start terminal without any parameters',
  },
  {
    label: '--continue',
    value: '--continue',
    description: 'Continue the previous session',
  },
  {
    label: '--resume',
    value: '--resume',
    description: 'Resume from the last checkpoint',
  },
];

export const TerminalParameterDialog: React.FC<TerminalParameterDialogProps> = ({
  open,
  onClose,
  onConfirm,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedParameters, setSelectedParameters] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setSelectedIndex(0);
      setSelectedParameters([]);
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!open) return;

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : TERMINAL_PARAMETERS.length - 1));
          break;
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) => (prev < TERMINAL_PARAMETERS.length - 1 ? prev + 1 : 0));
          break;
        case ' ':
        case 'Space':
          event.preventDefault();
          handleToggleParameter(selectedIndex);
          break;
        case 'Enter':
          event.preventDefault();
          const selectedParameter = TERMINAL_PARAMETERS[selectedIndex];
          const parametersToSend = selectedParameter.value === '' ? [] : [selectedParameter.value];
          onConfirm(parametersToSend);
          onClose();
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, selectedIndex, selectedParameters, onClose]);

  const handleToggleParameter = (index: number) => {
    const parameter = TERMINAL_PARAMETERS[index];
    if (parameter.value === '') {
      setSelectedParameters([]);
    } else {
      setSelectedParameters((prev) => {
        const isSelected = prev.includes(parameter.value);
        if (isSelected) {
          return prev.filter((p) => p !== parameter.value);
        } else {
          return [...prev.filter((p) => p !== ''), parameter.value];
        }
      });
    }
  };

  const isParameterSelected = (parameter: TerminalParameter) => {
    if (parameter.value === '') {
      return selectedParameters.length === 0;
    }
    return selectedParameters.includes(parameter.value);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Select Terminal Parameters</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Use arrow keys to navigate and Enter to start with the selected parameter.
        </Typography>
        <List ref={listRef}>
          {TERMINAL_PARAMETERS.map((parameter, index) => (
            <ListItem key={parameter.value || 'default'} disablePadding>
              <ListItemButton
                selected={selectedIndex === index}
                onClick={() => {
                  setSelectedIndex(index);
                  handleToggleParameter(index);
                }}
                sx={{
                  borderRadius: 1,
                  mb: 0.5,
                  '&.Mui-selected': {
                    backgroundColor: 'action.selected',
                  },
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="subtitle1">{parameter.label}</Typography>
                      {parameter.value && (
                        <Chip label={parameter.value} size="small" color="primary" />
                      )}
                    </Box>
                  }
                  secondary={parameter.description}
                />
                {isParameterSelected(parameter) && (
                  <CheckCircleOutline color="primary" />
                )}
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Cancel (Esc)
        </Button>
        <Button onClick={() => {
          const selectedParameter = TERMINAL_PARAMETERS[selectedIndex];
          const parametersToSend = selectedParameter.value === '' ? [] : [selectedParameter.value];
          onConfirm(parametersToSend);
          onClose();
        }} variant="contained" color="primary">
          Start Terminal (Enter)
        </Button>
      </DialogActions>
    </Dialog>
  );
};