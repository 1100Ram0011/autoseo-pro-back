export const createApiError = (message) => {
    const error = new Error(message);
    error.success = false;
    error.message = message;
    return error;
}