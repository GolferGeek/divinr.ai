export { AUTH_SERVICE } from './interfaces/auth-service.interface';
export type {
  AuthServiceProvider,
  SupabaseAuthUserDto,
} from './interfaces/auth-service.interface';
export { IDENTITY_PROVIDER } from './interfaces/identity-provider.interface';
export type { IdentityProvider } from './interfaces/identity-provider.interface';
export type { AuthenticatedPrincipal } from './interfaces/authenticated-principal.interface';
export { SupabaseIdentityProvider } from './providers/supabase-identity.provider';
export { Auth0IdentityProvider } from './providers/auth0-identity.provider';
export { AzureOidcIdentityProvider } from './providers/azure-oidc-identity.provider';
export { SupabaseAuthService } from './services/supabase-auth.service';
export { ExternalOidcAuthService } from './services/external-oidc-auth.service';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export { Public, IS_PUBLIC_KEY } from './decorators/public.decorator';
export { CurrentUser } from './decorators/current-user.decorator';
// AuthModule stays in each product's auth/ — it has app-specific imports (SupabaseModule, RbacModule)
