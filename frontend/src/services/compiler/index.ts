interface CompilationResult {
  success: boolean;
  bytecode?: string;
  errors?: string[];
  warnings?: string[];
}

export const compileContract = async (code: string): Promise<string> => {
  try {
    const response = await fetch(`${process.env.REACT_APP_API_URL}/api/compile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Compilation failed');
    }

    const result: CompilationResult = await response.json();
    
    if (!result.success || !result.bytecode) {
      throw new Error(result.errors?.join('\n') || 'Unknown compilation error');
    }

    return result.bytecode;
  } catch (error) {
    console.error('Compilation Error:', error);
    throw error;
  }
};
