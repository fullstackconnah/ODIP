FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy solution and project files
COPY Odip.sln .
COPY Odip.Domain/Odip.Domain.csproj Odip.Domain/
COPY Odip.Application/Odip.Application.csproj Odip.Application/
COPY Odip.Infrastructure/Odip.Infrastructure.csproj Odip.Infrastructure/
COPY Odip.Api/Odip.Api.csproj Odip.Api/
COPY Odip.Tests/Odip.Tests.csproj Odip.Tests/

# Restore dependencies
RUN dotnet restore

# Copy everything and build
COPY . .

# Test gate: a failing test fails the image build, which stops the deploy
# before any container is replaced. Runs here rather than as a separate CI
# step so it reuses the restore layer above instead of re-fetching packages.
RUN dotnet test Odip.Tests/Odip.Tests.csproj -c Release --no-restore

RUN dotnet publish Odip.Api/Odip.Api.csproj -c Release -o /app/publish

# Runtime image
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# Create data directory for document uploads
RUN mkdir -p /data/documents

ENV ASPNETCORE_URLS=http://+:5000
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 5000

ENTRYPOINT ["dotnet", "Odip.Api.dll"]
