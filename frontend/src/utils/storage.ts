interface StorageItem {
  value: any;
  timestamp: number;
  expiry?: number;
}

export const storage = {
  set: (key: string, value: any, expiry?: number) => {
    const item: StorageItem = {
      value,
      timestamp: Date.now(),
      expiry,
    };
    localStorage.setItem(key, JSON.stringify(item));
  },

  get: (key: string): any => {
    const item = localStorage.getItem(key);
    if (!item) return null;

    const { value, timestamp, expiry } = JSON.parse(item);
    
    if (expiry && Date.now() - timestamp > expiry) {
      localStorage.removeItem(key);
      return null;
    }

    return value;
  },

  remove: (key: string) => {
    localStorage.removeItem(key);
  },

  clear: () => {
    localStorage.clear();
  },
};
