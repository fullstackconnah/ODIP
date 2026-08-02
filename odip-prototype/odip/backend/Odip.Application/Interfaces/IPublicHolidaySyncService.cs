using Odip.Application.Models;

namespace Odip.Application.Interfaces;

public interface IPublicHolidaySyncService
{
    Task<SyncResult> SyncAsync(int fromYear, int toYear, CancellationToken ct = default);
}
