import { ValidationResult, ValidationError } from '../../types';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export const validateCode = async (code: string): Promise<ValidationResult> => {
  try {
    // Create temporary directory for validation
    const tempDir = path.join(__dirname, '../../../temp', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });
    
    // Write code to file
    const sourcePath = path.join(tempDir, 'program.rs');
    await fs.writeFile(sourcePath, code);

    return new Promise((resolve, reject) => {
      const clippy = spawn('cargo', ['clippy'], {
        cwd: tempDir
      });

      let output = '';

      clippy.stdout.on('data', (data) => {
        output += data.toString();
      });

      clippy.stderr.on('data', (data) => {
        output += data.toString();
      });

      clippy.on('close', async (code) => {
        try {
          // Cleanup temporary files
          await fs.rm(tempDir, { recursive: true, force: true });

          const errors: ValidationError[] = parseClippyOutput(output);
          
          resolve({
            valid: code === 0,
            errors: errors.filter(e => e.severity === 'error'),
            warnings: errors.filter(e => e.severity === 'warning')
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('Validation Error:', error);
    throw error;
  }
};

const parseClippyOutput = (output: string): ValidationError[] => {
  const errors: ValidationError[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const match = line.match(/^(warning|error)(?:\[([^\]]+)\])?: (.+?) at ([^:]+):(\d+):(\d+)$/);
    if (match) {
      errors.push({
        severity: match[1] as 'error' | 'warning',
        message: match[3],
        line: parseInt(match[5], 10),
        column: parseInt(match[6], 10)
      });
    }
  }

  return errors;
};
