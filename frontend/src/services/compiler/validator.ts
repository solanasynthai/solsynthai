interface ValidationOptions {
  strict?: boolean;
  checkStyle?: boolean;
  checkSecurity?: boolean;
}

interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export const validateCode = async (
  code: string,
  options: ValidationOptions = {}
): Promise<ValidationError[]> => {
  try {
    const response = await fetch(`${process.env.REACT_APP_API_URL}/api/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code, options }),
    });

    if (!response.ok) {
      throw new Error('Validation request failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Validation Error:', error);
    throw error;
  }
};
