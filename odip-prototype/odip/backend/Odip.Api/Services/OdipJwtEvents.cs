using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace Odip.Api.Services;

/// <summary>The bearer events Program.cs installs, in one place so a test can run the same ones.</summary>
public static class OdipJwtEvents
{
    public static JwtBearerEvents Create() => new()
    {
        OnMessageReceived = context =>
        {
            if (string.IsNullOrEmpty(context.Token) && context.Request.Cookies.TryGetValue("odip_jwt", out var cookieToken))
            {
                context.Token = cookieToken;
            }
            return Task.CompletedTask;
        },
        OnTokenValidated = SessionRecheck.OnTokenValidated
    };
}
