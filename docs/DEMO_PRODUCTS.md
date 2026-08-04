# Demo / QA товары для cross-marketplace поиска

Версия: **0.9.30**  
Используйте на чистом профиле Chrome «PriceGuard QA».

## Smoke (3 минуты)

| # | Товар (source) | Ожидаемая категория | Что проверить |
|---|----------------|---------------------|---------------|
| 1 | Xiaomi Redmi Note 14 8/256 | smartphones | базовый cross-market |
| 2 | Roborock S8 Pro Ultra | appliances | robot vacuum infer + model |
| 3 | JBL Tune 770NC | headphones | model extract |

## Cross-market (10 товаров)

| # | Каноничный запрос | Категория | Retail-блок |
|---|-------------------|-----------|-------------|
| 1 | Samsung WW80T554 стиральная машина | appliances | Быттехника |
| 2 | Roborock S8 / Xiaomi Robot Vacuum | appliances | Быттехника |
| 3 | Redmond RMC-M90 мультиварка | appliances | Быттехника |
| 4 | Женское платье / кроссовки 38 | apparel / shoes | Одежда |
| 5 | L'Oréal тональный крем | cosmetics | Красота |
| 6 | Persil Color 3 кг | detergents | FMCG (регресс ≠ машина) |
| 7 | Amazfit Bip 5 / Xiaomi Smart Band 9 | wearables | Электроника |
| 8 | Royal Canin корм 2 кг | pet_food | Зоо |
| 9 | Комплект постельного белья 1.5 сп | home_textile | Дом |
| 10 | Optimum Nutrition Gold Standard | sports | Спорт |

## Регрессии (must pass)

- `Стиральный порошок Persil` → **detergents**, не appliances
- `Объектив Canon EF 50mm` → **lenses**, не cameras
- `Смартфон Redmi Note 14 8/256` vs `8/128` → score различается
- Размер M vs L в одежде → match не падает в ноль

## Команды

```bash
npm run test -- src/lib/popular-categories.test.ts
npm run package:zip
```
