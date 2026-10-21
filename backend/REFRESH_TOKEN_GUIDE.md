# 🔐 Guia de Implementação: Refresh Token com Spring Boot 3 & Spring Security 6

## 📋 Resumo da Implementação

Implementamos um sistema robusto de Refresh Token que permite:
- ✅ Geração segura de tokens com persistência em banco de dados
- ✅ Validação rigorosa (assinatura, expiração, revogação)
- ✅ Endpoint público `/api/auth/refresh` para renovar access tokens
- ✅ Tratamento de exceções customizado
- ✅ Rotação de tokens opcional (mais seguro)
- ✅ Logout completo (revogação de todos os tokens)

---

## 🗂️ Estrutura de Arquivos Criados

```
backend/src/main/java/tech/lemnova/continuum/
├── domain/token/
│   ├── RefreshToken.java              # Entidade MongoDB
│   └── RefreshTokenRepository.java     # Repositório Spring Data
│
├── infra/security/
│   └── RefreshTokenService.java        # Serviço de lógica de refresh
│
├── application/exception/
│   └── TokenRefreshException.java      # Exceção customizada
│
├── controller/dto/auth/
│   ├── RefreshTokenRequest.java        # DTO de requisição
│   └── RefreshTokenResponse.java       # DTO de resposta
│
└── controller/
    └── AuthController.java             # [ATUALIZADO] Novo endpoint /refresh
```

---

## 🚀 Como Usar

### 1️⃣ **Cliente: Solicitando Novo Access Token**

**Requisição POST:**
```bash
curl -X POST http://localhost:8080/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiI1YjNjZDg0OS1..."
  }'
```

**Resposta (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiJhYzM4ZTc2Mi1...",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "refreshToken": null
}
```

**Usar o novo Access Token:**
```bash
curl -H "Authorization: Bearer <accessToken>" \
  http://localhost:8080/api/protected-endpoint
```

---

### 2️⃣ **Fluxo Completo de Autenticação**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER LOGIN (POST /api/auth/login)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Response: accessToken + refreshToken                        │
│ • accessToken: válido por 1 hora                            │
│ • refreshToken: salvo no banco + válido por 7 dias         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CLIENT: Usa accessToken para requisições autenticadas    │
│    Authorization: Bearer accessToken                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
           ┌───────────┴──────────┐
           │                      │
           ▼                      ▼
    Token válido?           Token expirado?
    (< 1 hora)             (> 1 hora)
    │                      │
    ▼                      ▼
Continua                 POST /api/auth/refresh
usando                   com refreshToken
                         │
                         ▼
                    ┌──────────────────┐
                    │ Validações:      │
                    │ ✓ Assinatura OK  │
                    │ ✓ Não expirado   │
                    │ ✓ Não revogado   │
                    │ ✓ Existe BD      │
                    └────────┬─────────┘
                             │
                             ▼
                    Novo accessToken
                    (válido 1 hora)
```

---

## 🔒 Segurança: Validações Realizadas

O `RefreshTokenService` realiza **6 validações rigorosas**:

```java
1. ✅ Assinatura JWT (HMAC-HS256)
   └─> Detecta tokens forjados ou modificados

2. ✅ Tipo de Token (refresh vs access)
   └─> Rejeita se tentar usar access token no endpoint de refresh

3. ✅ Expiração (banco de dados)
   └─> Verifica se expiryDate > Instant.now()

4. ✅ Revogação (soft-delete)
   └─> Verifica se revokedAt == null

5. ✅ Existência no Banco (auditoria)
   └─> Garante que foi realmente emitido por nós

6. ✅ Propriedade (userId matching)
   └─> Garante que token pertence ao usuário que o usa
```

---

## 📨 Configuração de Cookies HttpOnly (Alternativa)

Se preferir receber o refresh token em **cookie seguro** em vez de JSON body:

### Passo 1: Atualizar AuthController

```java
@PostMapping("/refresh")
public ResponseEntity<RefreshTokenResponse> refresh(
    @CookieValue(value = "refreshToken", required = false) String refreshToken,
    @RequestHeader(value = "User-Agent", required = false) String userAgent
) {
    if (refreshToken == null || refreshToken.isBlank()) {
        throw new TokenRefreshException(
            "Refresh token não encontrado em cookie",
            "TOKEN_NOT_FOUND"
        );
    }
    
    Claims claims = refreshTokenService.validateRefreshToken(refreshToken);
    String newAccessToken = refreshTokenService.generateAccessTokenFromRefresh(claims);
    return ResponseEntity.ok(new RefreshTokenResponse(newAccessToken, 3600L));
}
```

### Passo 2: AuthService - Definir Cookie no Login

```java
// No método login() ou register():
response.addHeader("Set-Cookie", 
    String.format(
        "refreshToken=%s; Path=/; Max-Age=%d; HttpOnly; Secure; SameSite=Strict",
        refreshToken,
        7 * 24 * 60 * 60  // 7 dias
    )
);
```

### Passo 3: Client HTTP

```javascript
// O navegador envia o cookie automaticamente
fetch('/api/auth/refresh', { 
    method: 'POST',
    credentials: 'include'  // ⭐ IMPORTANTE: enviar cookies
})
```

---

## 🔄 Rotação de Tokens (Opcional - Mais Seguro)

Se quiser **novo refresh token a cada refresh** (rotation):

### Descomente em AuthController:

```java
@PostMapping("/refresh-with-rotation")
public ResponseEntity<RefreshTokenResponse> refreshWithRotation(
    @Valid @RequestBody RefreshTokenRequest request,
    @RequestHeader(value = "User-Agent", required = false) String userAgent
) {
    String oldRefreshToken = request.refreshToken();
    
    // Valida refresh token
    Claims claims = refreshTokenService.validateRefreshToken(oldRefreshToken);
    String userId = claims.get("userId", String.class);
    
    // Gera novo access token
    String newAccessToken = refreshTokenService.generateAccessTokenFromRefresh(claims);
    
    // ⭐ Gera novo refresh token
    String newRefreshToken = refreshTokenService.generateRefreshToken(userId, userAgent);
    
    // ⭐ Revoga o token antigo
    refreshTokenService.revokeToken(oldRefreshToken);
    
    return ResponseEntity.ok(
        RefreshTokenResponse.withRotation(newAccessToken, 3600L, newRefreshToken)
    );
}
```

**Vantagens:**
- 🔒 Se um refresh token vazar, será válido por pouco tempo
- 🛡️ Detecta reutilização (cliente deve sempre usar o novo)

**Desvantagens:**
- ⚠️ Mais complexo (cliente deve guardar novo token)
- 🔄 Mais requisições ao banco de dados

---

## 🧪 Testando com Curl/Postman

### Teste 1: Login
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'

# Salve os valores retornados:
# - accessToken
# - refreshToken
```

### Teste 2: Usar Access Token
```bash
curl -H "Authorization: Bearer <accessToken>" \
  http://localhost:8080/api/auth/me

# Deve funcionar por 1 hora
```

### Teste 3: Fazer Refresh (após access token expirar)
```bash
curl -X POST http://localhost:8080/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<refreshToken do login>"
  }'

# Recebe novo accessToken
```

### Teste 4: Erro - Token Expirado
```bash
curl -X POST http://localhost:8080/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<token expirado de 8 dias atrás>"
  }'

# Erro 401:
# {
#   "message": "Refresh token expirado",
#   "errorCode": "TOKEN_EXPIRED"
# }
```

### Teste 5: Erro - Token Revogado (após logout)
```bash
# Primeiro faça logout
curl -X POST http://localhost:8080/api/auth/logout \
  -H "Authorization: Bearer <accessToken>"

# Agora tente usar o refreshToken
curl -X POST http://localhost:8080/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<token>"}'

# Erro 401:
# {
#   "message": "Refresh token foi revogado",
#   "errorCode": "TOKEN_REVOKED"
# }
```

---

## ⚙️ Configuração em application.properties

```properties
# JWT Configuration
jwt.secret=YOUR_VERY_LONG_SECRET_KEY_AT_LEAST_32_CHARACTERS_HERE
jwt.access-token.expiration=3600000   # 1 hora em ms
jwt.refresh-token.expiration=604800000  # 7 dias em ms

# MongoDB
spring.data.mongodb.uri=mongodb://localhost:27017/continuum
```

---

## 🧹 Limpeza de Tokens Expirados

Adicione um **scheduled task** para limpar tokens expirados:

```java
@Component
@EnableScheduling
public class TokenCleanupScheduler {
    
    private final RefreshTokenService refreshTokenService;
    
    public TokenCleanupScheduler(RefreshTokenService refreshTokenService) {
        this.refreshTokenService = refreshTokenService;
    }
    
    @Scheduled(fixedDelay = 86400000)  // A cada 24 horas
    public void cleanupExpiredTokens() {
        long deleted = refreshTokenService.cleanupExpiredTokens();
        System.out.println("Limpeza de tokens: " + deleted + " deletados");
    }
}
```

---

## 📊 Estrutura do Banco de Dados (MongoDB)

```javascript
db.refresh_tokens.find()

// Exemplo de documento:
{
  "_id": ObjectId("..."),
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "userId": "64d3f8a2c1e2f4g5h6i7j8k9",
  "issuedAt": ISODate("2025-05-26T10:00:00Z"),
  "expiryDate": ISODate("2025-06-02T10:00:00Z"),  // 7 dias depois
  "revokedAt": null,  // null = válido, Instant = revogado
  "clientInfo": "Mozilla/5.0... (para auditoria)"
}
```

---

## 🛑 Tratamento de Erros

### Códigos de Erro Implementados:

| Erro | Status HTTP | Causa | Ação Recomendada |
|------|-------------|-------|------------------|
| `TOKEN_EXPIRED` | 401 | Token validade expirou | Fazer novo login |
| `TOKEN_NOT_FOUND` | 401 | Token não existe no BD | Fazer novo login |
| `TOKEN_REVOKED` | 401 | Token foi revogado (logout) | Fazer novo login |
| `INVALID_SIGNATURE` | 401 | Token foi alterado/forjado | Rejeitar, fazer login |
| `INVALID_TOKEN_TYPE` | 401 | Tentou usar access token aqui | Bug do cliente |
| `TOKEN_USER_MISMATCH` | 401 | Token de outro usuário | Erro de segurança, fazer login |

---

## 📝 Logs & Auditoria

O sistema registra:

```
[INFO] Gerando refresh token para usuário: user123
[INFO] Refresh token gerado e salvo para usuário: user123
[INFO] Refresh token validado com sucesso para usuário: user123
[INFO] Refresh token revogado para usuário: user123
[WARN] Tentativa de usar refresh token de outro usuário. Token: userA, Banco: userB
[ERROR] Erro ao validar refresh token: signature verification failed
```

---

## ✨ Próximas Melhorias Opcionais

1. **Hash de Tokens**: Armazenar SHA-256 do token em vez do token completo
   ```java
   String hashedToken = DigestUtils.sha256Hex(token);
   ```

2. **TTL Automático no MongoDB**:
   ```java
   @Indexed(expireAfterSeconds = 604800) // Auto-delete após 7 dias
   private Instant expiryDate;
   ```

3. **Device Tracking**: Salvar device ID para revocar por dispositivo
   ```java
   private String deviceId;
   private String deviceName;
   ```

4. **Limite de Tokens por Usuário**: Máximo 5 tokens ativos
   ```java
   List<RefreshToken> tokens = findByUserIdAndRevokedAtIsNull(userId);
   if (tokens.size() >= 5) revoke(tokens.get(0));
   ```

5. **Refresh Token Rotation Automática**: Gerar novo refresh a cada uso
   - Mais seguro contra token leaks
   - Implementado em `/refresh-with-rotation`

---

## 🔗 Referências

- [Spring Security 6 Docs](https://spring.io/projects/spring-security)
- [JWT.io - JWT Specification](https://jwt.io)
- [MongoDB TTL Indexes](https://docs.mongodb.com/manual/core/index-ttl/)
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)

---

## ✅ Checklist de Segurança

- [x] Token JWT assinado com HS256 (256 bits min)
- [x] Refresh token persistido no banco (auditoria)
- [x] Validação rigorosa de assinatura
- [x] Validação de expiração
- [x] Validação de revogação (soft-delete)
- [x] Validação de propriedade (userId)
- [x] Exceção customizada com códigos de erro
- [x] Logs estruturados para auditoria
- [x] Endpoint de refresh é público (não autenticado)
- [x] Access token curto (1h), Refresh token longo (7d)
- [x] Logout revoga tokens (não deleta, para auditoria)
- [x] Cookies com HttpOnly + Secure (opcional)
- [ ] Hash de token em produção (recomendado)
- [ ] Cleanup automático de tokens expirados
- [ ] Rate limiting no endpoint `/refresh`

