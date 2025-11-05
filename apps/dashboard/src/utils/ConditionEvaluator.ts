import { TestResult } from '../types';

export class ConditionEvaluator {
    static evaluate(condition: string, payload: TestResult['results']): { result: boolean; error?: string } {
        try {
            // Create a safe evaluation context
            const context = this.createContext(payload);

            // Parse and evaluate the condition
            const normalizedCondition = this.normalizeCondition(condition);
            const result = this.evaluateExpression(normalizedCondition, context);

            return { result: Boolean(result) };
        } catch (error) {
            return {
                result: false,
                error: error instanceof Error ? error.message : 'Invalid condition syntax'
            };
        }
    }

    private static createContext(payload: TestResult['results']): any {
        return {
            email: payload.email || {},
            phone: payload.phone || {},
            address: payload.address || {},
            name: payload.name || {},
            // Helper functions
            exists: (value: any) => value !== null && value !== undefined,
            isEmpty: (value: any) => !value || (typeof value === 'object' && Object.keys(value).length === 0),
        };
    }

    private static normalizeCondition(condition: string): string {
        // Replace common operators with JavaScript equivalents
        return condition
            .replace(/\bAND\b/gi, '&&')
            .replace(/\bOR\b/gi, '||')
            .replace(/\bNOT\b/gi, '!')
            .replace(/\b==\b/g, '===')
            .replace(/\b!=\b/g, '!==');
    }

    private static evaluateExpression(expression: string, context: any): boolean {
        // This is a simplified evaluator - in production, use a proper expression parser
        // For demo purposes, we'll use a basic evaluation
        try {
            // Create a function that evaluates the expression in the context
            const func = new Function(...Object.keys(context), `return ${expression}`);
            return func(...Object.values(context));
        } catch {
            // Fallback to simple string matching for demo
            return this.simpleEvaluate(expression, context);
        }
    }

    private static simpleEvaluate(expression: string, context: any): boolean {
        // Simple evaluation for common patterns
        if (expression.includes('address.valid === false')) {
            return context.address?.valid === false;
        }
        if (expression.includes('address.country')) {
            const country = context.address?.normalized?.country || context.address?.country;
            if (expression.includes('!== "US"')) return country !== 'US';
            if (expression.includes('=== "US"')) return country === 'US';
        }
        if (expression.includes('email.risk_score')) {
            const score = context.email?.risk_score || 0;
            const match = expression.match(/email\.risk_score\s*([><=]+)\s*([\d.]+)/);
            if (match) {
                const operator = match[1];
                const value = parseFloat(match[2]);
                switch (operator) {
                    case '>': return score > value;
                    case '<': return score < value;
                    case '>=': return score >= value;
                    case '<=': return score <= value;
                    case '===': return score === value;
                }
            }
        }
        return false;
    }
}