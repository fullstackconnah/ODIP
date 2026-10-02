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
}
