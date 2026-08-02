using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Moq;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests;

public class CurrentTenantTests
{
    private static CurrentTenant Build(ClaimsPrincipal? principal)
    {
        var mockAccessor = new Mock<IHttpContextAccessor>();
        if (principal is null)
        {
            mockAccessor.Setup(a => a.HttpContext).Returns((HttpContext?)null);
        }
        else
        {
            var mockContext = new Mock<HttpContext>();
            var mockRequest = new Mock<HttpRequest>();
            var mockHeaders = new Mock<IHeaderDictionary>();
            mockHeaders.Setup(h => h["X-View-As-Tenant"]).Returns((string?)null);
            mockRequest.Setup(r => r.Headers).Returns(mockHeaders.Object);
            mockContext.Setup(c => c.User).Returns(principal);
            mockContext.Setup(c => c.Request).Returns(mockRequest.Object);
            mockAccessor.Setup(a => a.HttpContext).Returns(mockContext.Object);
        }
        return new CurrentTenant(mockAccessor.Object);
    }

    private static ClaimsPrincipal Principal(IEnumerable<Claim> claims, string? role = null)
    {
        var allClaims = claims.ToList();
        if (role is not null)
            allClaims.Add(new Claim(ClaimTypes.Role, role));
        var identity = new ClaimsIdentity(allClaims, "Test");
        return new ClaimsPrincipal(identity);
    }

    [Fact]
    public void NullHttpContext_TenantIdIsNull_IsSuperAdminFalse()
    {
        var sut = Build(null);
        Assert.Null(sut.TenantId);
        Assert.False(sut.IsSuperAdmin);
    }

    [Fact]
    public void ValidTenantIdClaim_ParsedCorrectly()
    {
        var id = Guid.NewGuid();
        var principal = Principal([new Claim("tenant_id", id.ToString())]);
        var sut = Build(principal);
        Assert.Equal(id, sut.TenantId);
    }

    [Fact]
    public void MissingTenantIdClaim_TenantIdIsNull()
    {
        var principal = Principal([]);
        var sut = Build(principal);
        Assert.Null(sut.TenantId);
    }

    [Fact]
    public void SuperAdminRole_IsSuperAdminTrue()
    {
        var principal = Principal([], role: "SuperAdmin");
        var sut = Build(principal);
        Assert.True(sut.IsSuperAdmin);
    }

    [Fact]
    public void NonSuperAdminRole_IsSuperAdminFalse()
    {
        var principal = Principal([], role: "Coordinator");
        var sut = Build(principal);
        Assert.False(sut.IsSuperAdmin);
    }

    [Fact]
    public void MalformedTenantIdClaim_TenantIdIsNull()
    {
        var principal = Principal([new Claim("tenant_id", "not-a-guid")]);
        var sut = Build(principal);
        Assert.Null(sut.TenantId);
    }

    private static CurrentTenant BuildWithHeader(ClaimsPrincipal principal, string? headerValue)
    {
        var mockAccessor = new Mock<IHttpContextAccessor>();
        var mockContext = new Mock<HttpContext>();
        var mockRequest = new Mock<HttpRequest>();
        var mockHeaders = new Mock<IHeaderDictionary>();
        
        // Setup headers to return the headerValue when accessed
        mockHeaders
            .Setup(h => h["X-View-As-Tenant"])
            .Returns(() => headerValue);
        
        mockRequest.Setup(r => r.Headers).Returns(mockHeaders.Object);
        mockContext.Setup(c => c.User).Returns(principal);
        mockContext.Setup(c => c.Request).Returns(mockRequest.Object);
        mockAccessor.Setup(a => a.HttpContext).Returns(mockContext.Object);
        return new CurrentTenant(mockAccessor.Object);
    }

    [Fact]
    public void SuperAdmin_WithValidHeader_ScopedToOverrideTenant_IsSuperAdminFalse()
    {
        var overrideId = Guid.NewGuid();
        var principal = Principal([new Claim("tenant_id", Guid.NewGuid().ToString())], role: "SuperAdmin");
        var sut = BuildWithHeader(principal, overrideId.ToString());
        Assert.Equal(overrideId, sut.TenantId);
        Assert.False(sut.IsSuperAdmin);
    }

    [Fact]
    public void SuperAdmin_WithInvalidHeader_RemainsUnscoped_IsSuperAdminTrue()
    {
        var ownId = Guid.NewGuid();
        var principal = Principal([new Claim("tenant_id", ownId.ToString())], role: "SuperAdmin");
        var sut = BuildWithHeader(principal, "not-a-guid");
        Assert.Equal(ownId, sut.TenantId);
        Assert.True(sut.IsSuperAdmin);
    }

    [Fact]
    public void SuperAdmin_WithNoHeader_RemainsUnscoped_IsSuperAdminTrue()
    {
        var ownId = Guid.NewGuid();
        var principal = Principal([new Claim("tenant_id", ownId.ToString())], role: "SuperAdmin");
        var sut = BuildWithHeader(principal, null);
        Assert.Equal(ownId, sut.TenantId);
        Assert.True(sut.IsSuperAdmin);
    }

}
