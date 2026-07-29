# Chrome Web Store assets — PriceGuard AI 0.9.x



## Brand (icons & promo)



**Стиль:** тёмный squircle (#0B161A), 3D-щит с teal/cyan свечением, бирка с белой **P**, подпись **AI**.



| Asset | Path |

|-------|------|

| Master source | `docs/store-assets/icons/brand-master-source.png` |

| Master 1024×1024 | `docs/store-assets/icons/brand-master-1024.png` |

| Extension UI | `public/icons/icon{16,32,48,128}.png` |

| CWS store icon | `docs/store-assets/icons/store-icon-128.png` |

| Small promo | `docs/store-assets/icons/small-promo-440x280.png` |

| Marquee (Featured) | `docs/store-assets/icons/marquee-1400x560.png` |



Пересборка из master:



```bash

npm run icons

```



Скрипт: `scripts/generate-icons.mjs` (sharp). Запускается также на `postinstall`.



Packaged in zip via `npm run package:zip` — только UI icons из `public/icons/`; CWS promo/marquee остаются в `docs/store-assets/`.



## Screenshots (7 × 1280×800)



| File | Listing title | CWS order |

|------|---------------|-----------|

| `01-compare.png` | Где дешевле — сразу | **#1 обязательно** |

| `02-ai-reviews.png` | AI-анализ отзывов | **#2 обязательно** |

| `03-tracking.png` | Мои товары | **#3 обязательно** |

| `04-price-history.png` | Скидка и история цен | **#4 обязательно** |

| `05-full-analysis.png` | Полный AI-разбор | **#5 обязательно** |

| `06-telegram-ai.png` | Telegram без Chrome | опционально #6 |

| `07-telegram-alert.png` | Алерты в Telegram | опционально #7 |



Live captures (0.9.x popup) + marketing frame. Исходники и пересборка:



`C:\Users\sj480\OneDrive\Desktop\screenshots for CWS\photopea-mockup\`



```powershell

powershell -ExecutionPolicy Bypass -File build-mockups.ps1

```



Upload in Developer Dashboard → Store listing → Screenshots (минимум 5, рекомендуется порядок 01→05).



## QA перед загрузкой



1. Нет Chat ID / email / личных данных на скринах.

2. Размер каждого PNG: **1280×800** (скриншоты), **128×128** (icon), **440×280** / **1400×560** (promo).

3. `icon16` читается в toolbar Chrome.

4. Текст на promo-баннерах соответствует UI (вкладки: Цены, Отзывы, Мои товары, …).

