// In apps/api/src/types/blocked-at.d.ts

declare module 'blocked-at' {
    interface Options {
        threshold?: number;
        trimFalseFrames?: boolean;
    }

    function blockedAt(
        callback: (time: number, stack: string[], details: any) => void,
        options?: Options
    ): NodeJS.Timeout;

    export default blockedAt;
}