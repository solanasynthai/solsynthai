interface OptimizationOptions {
  level: 'minimal' | 'standard' | 'aggressive';
  preserveComments?: boolean;
  inlineThreshold?: number;
}

export const optimizeCode = async (
  code: string,
  options: OptimizationOptions = { level: 'standard' }
): Promise<string> => {
  try {
    const response = await fetch(`${process.env.REACT_APP_API_URL}/api/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code, options }),
    });

    if (!response.ok) {
      throw new Error('Optimization request failed');
    }

    const result = await response.json();
    return result.optimizedCode;
  } catch (error) {
    console.error('Optimization Error:', error);
    throw error;
  }
};
