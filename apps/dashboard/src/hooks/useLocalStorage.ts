// src/hooks/useLocalStorage.ts
import { useState } from 'react';

export const useLocalStorage = <T,>(key: string, initialValue: T, storage: Storage = window.localStorage): [T, (value: T) => void] => {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = storage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch {
            return initialValue;
        }
    });

    const setValue = (value: T) => {
        try {
            setStoredValue(value);
            storage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error(`Error saving to storage:`, error);
        }
    };

    return [storedValue, setValue];
};