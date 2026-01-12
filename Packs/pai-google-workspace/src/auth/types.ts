export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
  scope: string;
  email?: string; // Account email for identification
}

export interface MultiAccountTokenStorage {
  accounts: Record<string, GoogleTokens>;
  defaultAccount?: string;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}
