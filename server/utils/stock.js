// Equipment can have several identical units in stock (e.g. 20 belt sheets),
// and a rental line takes some quantity of them. These helpers keep
// equipment.current_status in step with how many units are actually out.

const OPEN_STATUSES = "('active', 'overdue')";

// Units of this equipment out on open rentals, optionally ignoring one rental
// line (when that line is being edited).
async function unitsOut(equipmentId, executor, excludeRentalId = null) {
  const result = await executor.execute({
    sql: `SELECT COALESCE(SUM(quantity), 0) AS units FROM rentals
          WHERE equipment_id = ? AND rental_status IN ${OPEN_STATUSES} AND id <> ?`,
    args: [equipmentId, excludeRentalId ?? 0],
  });
  return Number(result.rows[0].units);
}

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

// Locks the equipment row for the rest of the transaction and checks `quantity`
// more units can go out, so two orders can't both take the last unit.
async function reserveUnits(equipmentId, quantity, tx, excludeRentalId = null) {
  const result = await tx.execute({
    sql: 'SELECT id, name, current_status, stock_quantity FROM equipment WHERE id = ? AND is_deleted = 0 FOR UPDATE',
    args: [equipmentId],
  });
  const equipment = result.rows[0];
  if (!equipment) throw httpError(404, `Equipment #${equipmentId} not found`);
  if (equipment.current_status === 'maintenance' || equipment.current_status === 'reserved') {
    throw httpError(409, `${equipment.name} is ${equipment.current_status === 'maintenance' ? 'under maintenance' : 'reserved'}`);
  }
  const free = equipment.stock_quantity - await unitsOut(equipmentId, tx, excludeRentalId);
  if (quantity > free) {
    throw httpError(409, free > 0
      ? `Only ${free} of ${equipment.name} available (asked for ${quantity})`
      : `${equipment.name} is not available for rent`);
  }
  return equipment;
}

// "rented" once every unit is out, back to "available" when one comes back.
// Maintenance / reserved are set by hand and left alone.
async function syncEquipmentStatus(equipmentIds, executor) {
  const now = new Date().toISOString();
  for (const id of new Set(equipmentIds)) {
    const out = await unitsOut(id, executor);
    await executor.execute({
      sql: `UPDATE equipment SET current_status = CASE
              WHEN ? >= stock_quantity THEN 'rented'
              WHEN current_status = 'rented' THEN 'available'
              ELSE current_status END,
            updated_at = ?
            WHERE id = ?`,
      args: [out, now, id],
    });
  }
}

module.exports = { OPEN_STATUSES, unitsOut, reserveUnits, syncEquipmentStatus, httpError };
