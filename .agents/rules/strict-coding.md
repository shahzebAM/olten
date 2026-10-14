# Coding Standards: Conciseness & Accuracy

When writing or modifying code in this project, you must adhere strictly to the following rules:

1. **Conciseness Over Boilerplate:** Write lean, idiomatic TypeScript. Do not generate redundant wrapper functions or unnecessary comments explaining obvious logic. 
2. **Framework Efficiency:** Leverage built-in framework features (like NestJS decorators, pipes, and global exception filters) instead of writing custom boilerplate for routing, validation, or error handling.
3. **Strict Typing:** Avoid `any`. Use strict TypeScript interfaces and DTOs. If handling database operations (e.g., PostgreSQL), ensure schema types align perfectly with the application layer.
4. **Self-Correction First:** Before concluding that a coding task is complete, you must mentally review the code for common edge cases (null values, asynchronous race conditions, and unhandled promise rejections).
5. **No Hallucinations:** If an import, library, or method is required but its exact syntax is unknown, use your tools to search the workspace or read the documentation rather than guessing.