import { createClient } from "@orbitcheck/contracts";
import { API_BASE } from '../constants';

export const apiClient = createClient({ baseUrl: API_BASE });
