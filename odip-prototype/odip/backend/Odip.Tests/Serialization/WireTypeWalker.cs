using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Serialization;

namespace Odip.Tests.Serialization;

/// <summary>
/// Finds every <see cref="DateTime"/> / <see cref="DateTime"/>? property that crosses the API wire - reachable from a controller
/// action's return type or its [FromBody] parameter - and reports how the REAL API JSON options write it. The inventory in
/// DateTimeWireInventoryTests is built on this, so a DateTime added to any DTO (or entity returned directly) is classified
/// without anyone remembering to list it.
/// </summary>
internal static class WireTypeWalker
{
    internal sealed record Field(Type Owner, PropertyInfo Property, Type ReachedVia)
    {
        /// <summary>"Odip.Application.DTOs.AdminUserDto.LastLoginAt": the stable name the inventory uses.</summary>
        public string Key => $"{Owner.FullName}.{Property.Name}";
        public bool IsNullable => Nullable.GetUnderlyingType(Property.PropertyType) is not null;
    }

    /// <summary>The options the server uses: MVC's web defaults plus the one policy method Program.cs calls.</summary>
    public static JsonSerializerOptions ApiOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return options;
    }

    public static IReadOnlyList<Field> DateTimeFields()
    {
        var roots = new List<Type>();
        var api = typeof(Odip.Api.Controllers.MedicationsController).Assembly;
        foreach (var controller in api.GetTypes().Where(t => t.IsClass && !t.IsAbstract && typeof(ControllerBase).IsAssignableFrom(t)))
        {
            foreach (var method in controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                if (method.IsSpecialName) continue;
                roots.Add(method.ReturnType);
                foreach (var parameter in method.GetParameters())
                    if (parameter.GetCustomAttributes<FromBodyAttribute>().Any()) roots.Add(parameter.ParameterType);
            }
        }

        // An action that returns a bare IActionResult hides its payload type from the signature, so every public type in the
        // DTOs namespace is a root too: a DTO is on the wire by definition.
        roots.AddRange(typeof(Odip.Application.DTOs.AdminUserDto).Assembly.GetTypes()
            .Where(t => t.IsPublic && t.Namespace == "Odip.Application.DTOs"));

        var seen = new HashSet<Type>();
        var found = new Dictionary<string, Field>();
        foreach (var root in roots) Visit(root, root, seen, found);
        return found.Values.OrderBy(f => f.Key, StringComparer.Ordinal).ToList();
    }

    private static bool IsOdip(Type t) => t.Namespace is { } ns && ns.StartsWith("Odip", StringComparison.Ordinal);

    private static void Visit(Type type, Type root, HashSet<Type> seen, Dictionary<string, Field> found)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        if (type.IsArray) { Visit(type.GetElementType()!, root, seen, found); return; }
        if (type.IsGenericType)
        {
            foreach (var argument in type.GetGenericArguments()) Visit(argument, root, seen, found);
            if (!IsOdip(type)) return; // Task<>, ActionResult<>, List<>, Dictionary<,>: only the arguments matter
        }
        if (!IsOdip(type) || type.IsEnum || type.IsInterface || type.IsAbstract && type.IsSealed) return;
        if (!seen.Add(type)) return;

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (!property.CanRead || property.GetIndexParameters().Length > 0) continue;
            if (property.GetCustomAttribute<JsonIgnoreAttribute>() is { Condition: JsonIgnoreCondition.Always }) continue;
            var propertyType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
            if (propertyType == typeof(DateTime))
            {
                var field = new Field(property.DeclaringType ?? type, property, type);
                found.TryAdd(field.Key, field);
            }
            else
            {
                Visit(property.PropertyType, root, seen, found);
            }
        }
    }

    /// <summary>
    /// Writes <paramref name="field"/> holding <paramref name="value"/> through the real API options and returns the JSON string value,
    /// or null when the property was not written. Only that one property is serialised, so an unrelated getter cannot throw.
    /// </summary>
    public static string? WriteAlone(Field field, DateTime? value, Type? instanceType = null)
    {
        instanceType ??= field.ReachedVia;
        var camel = JsonNamingPolicy.CamelCase.ConvertName(field.Property.Name);
        var options = new JsonSerializerOptions(ApiOptions())
        {
            TypeInfoResolver = new DefaultJsonTypeInfoResolver
            {
                Modifiers =
                {
                    typeInfo =>
                    {
                        if (typeInfo.Type != instanceType || typeInfo.Kind != JsonTypeInfoKind.Object) return;
                        foreach (var property in typeInfo.Properties)
                            if (property.Name != camel) property.ShouldSerialize = static (_, _) => false;
                    },
                },
            },
        };

        var instance = System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject(instanceType);
        var property = instanceType.GetProperty(field.Property.Name)!;
        var boxed = value.HasValue ? (object)value.Value : null;
        if (property.CanWrite) property.SetValue(instance, boxed);
        else
        {
            var backing = instanceType.GetField($"<{field.Property.Name}>k__BackingField", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.FlattenHierarchy)
                ?? field.Property.DeclaringType?.GetField($"<{field.Property.Name}>k__BackingField", BindingFlags.Instance | BindingFlags.NonPublic);
            if (backing is null) return "(computed: not settable)";
            backing.SetValue(instance, boxed);
        }

        var json = JsonSerializer.Serialize(instance, instanceType, options);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.TryGetProperty(camel, out var written) && written.ValueKind == JsonValueKind.String ? written.GetString() : null;
    }
}
