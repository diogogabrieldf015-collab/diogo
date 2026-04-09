
UPDATE packages SET price = 466, discount_price = NULL WHERE quantity = 50;
UPDATE packages SET price = 736, discount_price = NULL WHERE quantity = 100;
UPDATE packages SET price = 990, discount_price = NULL WHERE quantity = 300;
UPDATE packages SET price = 1590, discount_price = NULL WHERE quantity = 1000;
UPDATE packages SET price = 5690, discount_price = NULL WHERE quantity = 10000;
DELETE FROM packages WHERE quantity = 3000;
INSERT INTO packages (quantity, price, active) VALUES (5000, 2790, true);
INSERT INTO packages (quantity, price, active) VALUES (20000, 7690, true);
INSERT INTO packages (quantity, price, active) VALUES (50000, 9090, true);
