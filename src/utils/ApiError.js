class ApiError extends Error {
    constructor(
        statusCode,
        message,
        isOperational = true,
        stack = ""
    ) {
        super(message);

        this.statusCode = statusCode;
        this.isOperational = isOperational;

        Error.captureStackTrace(this, this.constructor);

        if (stack) {
            this.stack = stack;
        }
    }
}

export default ApiError;