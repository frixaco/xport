-- Must return no rows. Never overwrite the local balance from Polar.
SELECT u.id, u.credit_balance, COALESCE(SUM(t.amount), 0) AS ledger_balance
FROM "user" u LEFT JOIN xport_credit_transactions t ON t.user_id = u.id
GROUP BY u.id HAVING u.credit_balance <> COALESCE(SUM(t.amount), 0);

SELECT operation_key, created_at, polar_attempts, polar_next_attempt_at, polar_last_error
FROM xport_credit_transactions
WHERE polar_payload IS NOT NULL AND polar_delivered_at IS NULL
ORDER BY created_at;
