export const beforeRequest = (request: RequestInit): RequestInit => {
  // Add authorization header if available
  const token = localStorage.getItem("auth_token");
  if (token) {
    request.headers = {
      ...request.headers,
      Authorization: `Bearer ${token}`,
    };
  }
  
  return request;
};