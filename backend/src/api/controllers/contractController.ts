
import { Request, Response, NextFunction } from 'express';
import { generateContractCode } from '../../services/ai/generation';
import { validateContractCode } from '../../services/ai/validation';
import { ContractTemplate } from '../../types';

export const generateContract = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { prompt, template } = req.body;
    const code = await generateContractCode(prompt, template);
    res.json({ success: true, code });
  } catch (error) {
    next(error);
  }
};

export const validateContract = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { code } = req.body;
    const result = await validateContractCode(code);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getTemplates = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Implementation would fetch templates from a database or file system
    const templates: ContractTemplate[] = [];
    res.json(templates);
  } catch (error) {
    next(error);
  }
};
