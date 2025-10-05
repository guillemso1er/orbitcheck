export const afterResponse = (response: Response): Response => {
  // Handle common response patterns
  if (response.status === 401) {
    // Redirect to login or refresh token
    window.location.href = "/login";
  }
  
  return response;
};