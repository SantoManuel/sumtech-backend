-- ==============================================================================
-- SUMTECH ERP - SCRIPT DE INICIALIZACIÓN DE ESQUEMAS (PostgreSQL 3NF)
-- ==============================================================================

-- Habilitar extensión UUID para generación de llaves primarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Crear los 6 esquemas lógicos normalizados
CREATE SCHEMA IF NOT EXISTS sec;      -- Seguridad, Usuarios, Roles, Auditoría y Nómina
CREATE SCHEMA IF NOT EXISTS com;      -- Comercial, Clientes, Direcciones, Planes y Contratos
CREATE SCHEMA IF NOT EXISTS pos;      -- Punto de Venta, Ventas, Cajas y Facturación e-CF DGII
CREATE SCHEMA IF NOT EXISTS inv;      -- Inventario, Equipos, Seriales, MACs y Kardex
CREATE SCHEMA IF NOT EXISTS tickets;  -- Órdenes de Trabajo, Averías, SLAs y Reparaciones
CREATE SCHEMA IF NOT EXISTS crm;      -- Gestión de Prospectos (Leads) e Interacciones 360°

-- Comentario descriptivo de base de datos
COMMENT ON SCHEMA sec IS 'Esquema de Seguridad, Cuentas de Acceso y Perfiles Laborales';
COMMENT ON SCHEMA com IS 'Esquema Comercial, Suscriptores, Direcciones y Contratos';
COMMENT ON SCHEMA pos IS 'Esquema de Punto de Venta, Arqueos y Facturación Electrónica DGII';
COMMENT ON SCHEMA inv IS 'Esquema de Inventario de Red, Hardware Serializado y Kardex';
COMMENT ON SCHEMA tickets IS 'Esquema de Soporte Técnico, Órdenes de Instalación y Averías';
COMMENT ON SCHEMA crm IS 'Esquema de Prospectos, Canales de Contacto e Interacciones';
