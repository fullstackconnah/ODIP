using System.Net;
using System.Reflection;
using FirebaseAdmin;
using FirebaseAdmin.Auth;

namespace Odip.Tests.Controllers;

/// <summary>
/// The Firebase Admin SDK builds its own <see cref="FirebaseAuthException"/>s and keeps the constructor internal, but the controllers
/// branch on <c>AuthErrorCode</c> (EmailAlreadyExists, UserNotFound), so a test that wants to drive those branches has to make one.
/// </summary>
internal static class FirebaseTestExceptions
{
    public static FirebaseAuthException WithCode(AuthErrorCode code)
    {
        var constructor = typeof(FirebaseAuthException)
            .GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            .First(c => c.GetParameters().Length > 0 && c.GetParameters()[0].ParameterType == typeof(ErrorCode));

        var arguments = constructor.GetParameters().Select(parameter => parameter.Position switch
        {
            0 => (object?)ErrorCode.AlreadyExists,
            1 => "simulated Firebase error",
            _ when parameter.ParameterType == typeof(AuthErrorCode?) => code,
            _ => parameter.HasDefaultValue ? parameter.DefaultValue : null,
        }).ToArray();

        return (FirebaseAuthException)constructor.Invoke(arguments);
    }

    public static FirebaseAuthException EmailAlreadyExists() => WithCode(AuthErrorCode.EmailAlreadyExists);

    /// <summary>
    /// What the SDK throws when the Identity Toolkit backend answers with this HTTP error, built by the SDK's own (internal) error handler, so a
    /// test sees the exact shape production would: the .NET SDK has no AuthErrorCode for most refusals, and a 400 arrives as
    /// <see cref="ErrorCode.InvalidArgument"/> with the raw response body in the message.
    /// </summary>
    public static FirebaseAuthException FromBackendResponse(HttpStatusCode status, string body)
    {
        const BindingFlags all = BindingFlags.Static | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        var handlerType = typeof(FirebaseAuthException).Assembly.GetType("FirebaseAdmin.Auth.AuthErrorHandler")!;
        var instance = handlerType.GetField("Instance", all)?.GetValue(null) ?? handlerType.GetProperty("Instance", all)!.GetValue(null);
        var handle = handlerType.BaseType!.GetMethod("HandleHttpErrorResponse", all)!;
        return (FirebaseAuthException)handle.Invoke(instance, [new HttpResponseMessage(status), body])!;
    }

    private static string BackendError(int code, string message, string status) =>
        $"{{\"error\":{{\"code\":{code},\"message\":\"{message}\",\"status\":\"{status}\"}}}}";

    /// <summary>A malformed address, as the backend refuses it (a 400 whose message is INVALID_EMAIL).</summary>
    public static FirebaseAuthException InvalidEmail() => FromBackendResponse(HttpStatusCode.BadRequest, BackendError(400, "INVALID_EMAIL", "INVALID_ARGUMENT"));

    /// <summary>A 400 that is about something other than the address.</summary>
    public static FirebaseAuthException WeakPassword() =>
        FromBackendResponse(HttpStatusCode.BadRequest, BackendError(400, "WEAK_PASSWORD : Password should be at least 6 characters", "INVALID_ARGUMENT"));

    /// <summary>The service account may not do this (a 403).</summary>
    public static FirebaseAuthException PermissionDenied() =>
        FromBackendResponse(HttpStatusCode.Forbidden, BackendError(403, "PERMISSION_DENIED", "PERMISSION_DENIED"));
}
