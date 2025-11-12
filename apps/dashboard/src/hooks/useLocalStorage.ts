// src/hooks/useLocalStorage.ts
import { useEffect, useState } from 'react';

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

    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === key && e.storageArea === storage) {
                try {
                    setStoredValue(e.newValue ? JSON.parse(e.newValue) : initialValue);
                } catch {
                    setStoredValue(initialValue);
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, [key, storage, initialValue]);

    return [storedValue, setValue];
};