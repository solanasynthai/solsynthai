import { spawn } from 'child_process';
import { CompilationResult } from '../../types';
import { DEFAULT_COMPILATION_OPTIONS } from '../../constants';
import path from 'path';
import fs from 'fs/promises';

interface CompilationOptions {
  optimizer?: {
    enabled: boolean;
    runs: number;
  };
  outputSelection?: Record<string, any>;
}

export const compileContract = async (
  code: string,
  options: CompilationOptions = DEFAULT_COMPILATION_OPTIONS
): Promise<CompilationResult> => {
  try {
    // Create temporary directory for compilation
    const tempDir = path.join(__dirname, '../../../temp', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });
    
    // Write code to file
    const sourcePath = path.join(tempDir, 'program.rs');
    await fs.writeFile(sourcePath, code);

    return new Promise((resolve, reject) => {
      const cargo = spawn('cargo', ['build-bpf'], {
        cwd: tempDir
      });

      let output = '';
      let errors = '';

      cargo.stdout.on('data', (data) => {
        output += data.toString();
      });

      cargo.stderr.on('data', (data) => {
        errors += data.toString();
      });

      cargo.on('close', async (code) => {
        try {
          // Cleanup temporary files
          await fs.rm(tempDir, { recursive: true, force: true });

          if (code !== 0) {
            resolve({
              success: false,
              errors: [errors]
            });
            return;
          }

          resolve({
            success: true,
            bytecode: output
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('Compilation Error:', error);
    throw error;
  }
};
