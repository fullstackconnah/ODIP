FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy solution and project files
COPY Odip.sln .
COPY Odip.Domain/Odip.Domain.csproj Odip.Domain/
COPY Odip.Application/Odip.Application.csproj Odip.Application/
COPY Odip.Infrastructure/Odip.Infrastructure.csproj Odip.Infrastructure/
COPY Odip.Api/Odip.Api.csproj Odip.Api/
# Odip.Tests is in the solution, so its csproj is needed for the restore. Tests run in CI (pr-validation.yml), not in the image.
COPY Odip.Tests/Odip.Tests.csproj Odip.Tests/

# Restore dependencies
RUN dotnet restore

# Copy everything and build
COPY . .

RUN dotnet publish Odip.Api/Odip.Api.csproj -c Release -o /app/publish

# Runtime image
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# curl for the Compose healthcheck against /api/health/ready — the aspnet:10.0 runtime
# image ships neither curl nor wget, so a healthcheck referencing either is permanently
# unhealthy without this layer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# Create data directory for document uploads
RUN mkdir -p /data/documents

ENV ASPNETCORE_URLS=http://+:5000
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 5000

ENTRYPOINT ["dotnet", "Odip.Api.dll"]
