import { createApiClient } from "@orbitcheck/contracts";
import { API_BASE } from "src/constants";

export const apiClient = createApiClient({ baseURL: API_BASE });
