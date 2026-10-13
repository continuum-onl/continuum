package onl.continuum.continuum.controller.dto.subscription;

public record CheckoutResponse(String sessionId, String url, String clientSecret, String publishableKey) {}
