import { Request, Response, NextFunction } from 'express';
import { MAX_CODE_SIZE, MAX_PROMPT_LENGTH } from '../../constants';

export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { code, prompt } = req.body;

  if (code && Buffer.byteLength(code, 'utf8') > MAX_CODE_SIZE) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Code size exceeds maximum limit'
      }
    });
  }

  if (prompt && prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Prompt length exceeds maximum limit'
      }
    });
  }

  next();
};
