import type { ValidationIssue } from './validation-issue.type.ts';

export class RequestValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(message: string, issues: ValidationIssue[], options?: ErrorOptions) {
    super(message, options);
    this.name = 'RequestValidationError';
    this.issues = issues;
  }
}
