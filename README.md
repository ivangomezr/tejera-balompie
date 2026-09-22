# ⚽ Tejera Balompié

PWA para la gestión integral de un club de fútbol amateur: convocatorias, estado de jugadores, temporadas y comunicación con el equipo, todo desde el móvil.

![Status](https://img.shields.io/badge/status-en%20desarrollo-brightgreen)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)
![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)

---

## 📋 Descripción

Tejera Balompié nació para resolver un problema muy concreto: la gestión de un club amateur de fútbol suele hacerse a base de grupos de WhatsApp. Esta app centraliza toda esa gestión en una PWA instalable, pensada para que cualquier miembro del equipo pueda usarla desde el móvil.

## ✨ Funcionalidades

- **Sistema de convocatorias** — gestión de convocados por partido, con estado de disponibilidad de cada jugador visible de un vistazo
- **Gestión de temporadas** — organización de la actividad del club por temporada
- **Perfiles de jugador** — con recorte y subida de imagen de perfil integrado (`ImageCropper`)
- **Notificaciones Push** — avisos en tiempo real vía Web Push, implementadas con Supabase Edge Functions
- **Sistema de superadmin** — gestión de permisos y roles dentro del club
- **Instalable como app (PWA)** — funciona en móvil como una aplicación nativa, con soporte específico para las peculiaridades de scroll y modales en IOS
- **Panel de actividad (Log)** — registro de acciones relevantes dentro del club solo para superusuario

### 🔜 En el roadmap
- PIN individual por jugador, para evitar que varios miembros compartan una misma cuenta y que nadie externo al equipo pueda modificar o eliminar cosas

## 🛠️ Stack técnico

| Capa | Tecnología |
|---|---|
| Backend / Base de datos | [Supabase](https://supabase.com) (PostgreSQL, Auth, Edge Functions) |
| Almacenamiento de imágenes | [Cloudinary](https://cloudinary.com) |
| Hosting / Deploy | [Vercel](https://vercel.com) |
| Notificaciones | Web Push API + Supabase Edge Functions |
| CI / Automatización | GitHub Actions |

## 🏗️ Decisiones de arquitectura

Algunas decisiones que no son evidentes solo mirando el código, pero que reflejan cómo ha evolucionado el proyecto:

- **Migración a Cloudinary**: el almacenamiento de imágenes empezó en Supabase Storage, pero el consumo de egress se acercaba al límite del plan gratuito. Se migró la gestión de imágenes a Cloudinary para descargar ese tráfico del backend principal.
- **Keep-alive con GitHub Actions**: los proyectos gratuitos de Supabase se pausan tras un periodo de inactividad, lo que corta la resolución DNS del proyecto. Para evitarlo, hay un workflow (`supabase-keep-alive.yml`) que hace ping periódico al proyecto y lo mantiene activo.


## 📱 Capturas


## 📄 Licencia

Este proyecto no tiene licencia específica actualmente.

---

Desarrollado por [Iván Gómez](https://github.com/ivangomezr) · Proyecto personal para la gestión de [Tejera Balompié](#)
