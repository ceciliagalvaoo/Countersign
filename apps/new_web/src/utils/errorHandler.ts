/**
 * Extract user-friendly error message from API error response
 */
export const getErrorMessage = (error: any): string => {
  // Check if error has response data (Axios error)
  if (error?.response?.data) {
    const { error: errorMsg, details, message } = error.response.data;
    
    // If there are validation details (Zod errors)
    if (details && Array.isArray(details) && details.length > 0) {
      const firstError = details[0];
      const field = firstError.path?.join('.') || 'field';
      const message = firstError.message || 'Invalid value';
      return `${field}: ${message}`;
    }
    
    // Return generic error message from API
    if (errorMsg) return errorMsg;
    if (message) return message;
  }
  
  // Check if error has a message property
  if (error?.message) {
    return error.message;
  }
  
  // Fallback to generic error
  return 'An unexpected error occurred';
};
