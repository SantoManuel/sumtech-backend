import * as dotenv from 'dotenv';
dotenv.config();

import { AppDataSource } from '../../config/database.config';
import { CountryEntity } from '../../modules/geography/entities/country.entity';
import { ProvinceEntity } from '../../modules/geography/entities/province.entity';
import { MunicipalityEntity } from '../../modules/geography/entities/municipality.entity';
import { SectorEntity } from '../../modules/geography/entities/sector.entity';

interface SectorSeed {
  name: string;
  postalCode?: string;
}

interface MunicipalitySeed {
  name: string;
  code?: string;
  postalCode?: string;
  sectors?: SectorSeed[];
}

interface ProvinceSeed {
  name: string;
  code: string;
  municipalities: MunicipalitySeed[];
}

// ==============================================================================
// CATÁLOGO GEOGRÁFICO OFICIAL DE LA REPÚBLICA DOMINICANA (32 DIVISIONES DE 1ER NIVEL)
// Con cobertura ultra-detallada en la provincia de Azua (operación de Sumtech)
// y cabeceras/municipios principales de todo el territorio nacional.
// ==============================================================================
export const DOMINICAN_REPUBLIC_GEO_DATA: ProvinceSeed[] = [
  // ----------------------------------------------------------------------------
  // 1. AZUA (Sede Operativa Principal de Sumtech Ramírez SRL)
  // ----------------------------------------------------------------------------
  {
    name: 'Azua',
    code: 'AZ',
    municipalities: [
      {
        name: 'Azua de Compostela',
        code: '020100',
        postalCode: '71000',
        sectors: [
          { name: 'Centro de la Ciudad', postalCode: '71000' },
          { name: 'Barrio Quisqueya', postalCode: '71001' },
          { name: 'Quisqueya II', postalCode: '71001' },
          { name: 'Alto de las Flores', postalCode: '71001' },
          { name: 'La Placeta', postalCode: '71001' },
          { name: 'El Prado', postalCode: '71002' },
          { name: 'Los Cartones', postalCode: '71002' },
          { name: 'Buenos Aires', postalCode: '71002' },
          { name: 'La Bombita', postalCode: '71003' },
          { name: 'Pueblo Abajo', postalCode: '71003' },
          { name: 'Simón Bolívar', postalCode: '71004' },
          { name: 'El Guayabal (Azua)', postalCode: '71004' },
          { name: 'Donde Vieja KM 15', postalCode: '71005' },
          { name: 'Cruce KM 15', postalCode: '71005' },
          { name: 'Las Guanábanas', postalCode: '71005' },
          { name: 'La Neverita', postalCode: '71006' },
          { name: 'Villa Esperanza', postalCode: '71006' },
          { name: 'El Recodo', postalCode: '71007' },
          { name: 'Los Parceleros', postalCode: '71007' },
          { name: 'Baranquinha', postalCode: '71008' },
        ],
      },
      {
        name: 'Las Yayas de Viajama',
        code: '020200',
        postalCode: '71000',
        sectors: [
          { name: 'Las Yayas Centro', postalCode: '71000' },
          { name: 'Las Yayas Arriba', postalCode: '71000' },
          { name: 'El Hatico', postalCode: '71000' },
          { name: 'Los Cerros', postalCode: '71000' },
          { name: 'Viajama', postalCode: '71000' },
          { name: 'Villar Pando', postalCode: '71000' },
          { name: 'Cruce Villar Pando', postalCode: '71000' },
          { name: 'El Palmar de Villar Pando', postalCode: '71000' },
          { name: 'Los Guineos', postalCode: '71000' },
        ],
      },
      {
        name: 'Tábara Arriba',
        code: '020300',
        postalCode: '71000',
        sectors: [
          { name: 'Tábara Arriba Centro', postalCode: '71000' },
          { name: 'Tábara Abajo', postalCode: '71000' },
          { name: 'Los Toros', postalCode: '71000' },
          { name: 'Los Toros Abajo', postalCode: '71000' },
          { name: 'Barrio Lindo (Los Toros)', postalCode: '71000' },
          { name: 'La Ceiba', postalCode: '71000' },
          { name: 'La Loma', postalCode: '71000' },
          { name: 'El Caliche', postalCode: '71000' },
          { name: 'Las Flores', postalCode: '71000' },
          { name: 'Amiama Gómez', postalCode: '71000' },
        ],
      },
      {
        name: 'Padre Las Casas',
        code: '020400',
        postalCode: '71000',
        sectors: [
          { name: 'Centro Padre Las Casas', postalCode: '71000' },
          { name: 'Barrio Santa Ana', postalCode: '71000' },
          { name: 'Las Cañitas', postalCode: '71000' },
          { name: 'Los Naranjos', postalCode: '71000' },
          { name: 'Monte Bonito', postalCode: '71000' },
        ],
      },
      {
        name: 'Peralta',
        code: '020500',
        postalCode: '71000',
        sectors: [
          { name: 'Peralta Centro', postalCode: '71000' },
          { name: 'El Higüero', postalCode: '71000' },
          { name: 'Majagual', postalCode: '71000' },
          { name: 'Puerta Vieja', postalCode: '71000' },
        ],
      },
      {
        name: 'Estebanía',
        code: '020600',
        postalCode: '71000',
        sectors: [
          { name: 'Estebanía Centro', postalCode: '71000' },
          { name: 'Las Barías', postalCode: '71000' },
          { name: 'La Curva', postalCode: '71000' },
          { name: 'Los Rincones', postalCode: '71000' },
        ],
      },
      {
        name: 'Guayabal',
        code: '020700',
        postalCode: '71000',
        sectors: [
          { name: 'Guayabal Centro', postalCode: '71000' },
          { name: 'El Gramazo', postalCode: '71000' },
          { name: 'La Guajaca', postalCode: '71000' },
        ],
      },
      {
        name: 'Pueblo Viejo',
        code: '020800',
        postalCode: '71000',
        sectors: [
          { name: 'Pueblo Viejo Centro', postalCode: '71000' },
          { name: 'Las Caobas', postalCode: '71000' },
          { name: 'El Riguito', postalCode: '71000' },
          { name: 'El Cascajal', postalCode: '71000' },
        ],
      },
      {
        name: 'Las Charcas',
        code: '020900',
        postalCode: '71000',
        sectors: [
          { name: 'Las Charcas Centro', postalCode: '71000' },
          { name: 'Palmar de Ocoa', postalCode: '71000' },
          { name: 'Hatillo', postalCode: '71000' },
        ],
      },
      {
        name: 'Sabana Yegua',
        code: '021000',
        postalCode: '71000',
        sectors: [
          { name: 'Sabana Yegua Centro', postalCode: '71000' },
          { name: 'Kilómetro 11', postalCode: '71000' },
          { name: 'Proyecto 4', postalCode: '71000' },
          { name: 'San Francisco', postalCode: '71000' },
        ],
      },
    ],
  },

  // ----------------------------------------------------------------------------
  // 2. DISTRITO NACIONAL (Capital)
  // ----------------------------------------------------------------------------
  {
    name: 'Distrito Nacional',
    code: 'DN',
    municipalities: [
      {
        name: 'Santo Domingo de Guzmán',
        code: '010100',
        postalCode: '10100',
        sectors: [
          { name: 'Piantini', postalCode: '10148' },
          { name: 'Bella Vista', postalCode: '10112' },
          { name: 'Naco', postalCode: '10124' },
          { name: 'Gazcue', postalCode: '10205' },
          { name: 'Evaristo Morales', postalCode: '10147' },
          { name: 'Los Prados', postalCode: '10132' },
          { name: 'Zona Colonial', postalCode: '10210' },
          { name: 'Mirador Sur', postalCode: '10111' },
          { name: 'Mirador Norte', postalCode: '10114' },
          { name: 'La Julia', postalCode: '10109' },
          { name: 'La Esperilla', postalCode: '10107' },
          { name: 'El Millón', postalCode: '10115' },
          { name: 'Los Cacicazgos', postalCode: '10113' },
          { name: 'San Carlos', postalCode: '10206' },
          { name: 'Villa Juana', postalCode: '10412' },
        ],
      },
    ],
  },

  // ----------------------------------------------------------------------------
  // 3. SANTO DOMINGO
  // ----------------------------------------------------------------------------
  {
    name: 'Santo Domingo',
    code: 'SD',
    municipalities: [
      {
        name: 'Santo Domingo Este',
        code: '010200',
        postalCode: '11500',
        sectors: [
          { name: 'Alma Rosa I', postalCode: '11503' },
          { name: 'Alma Rosa II', postalCode: '11504' },
          { name: 'Ensanche Ozama', postalCode: '11501' },
          { name: 'Lucerna', postalCode: '11516' },
          { name: 'Villa Faro', postalCode: '11511' },
          { name: 'Brisa Oriental', postalCode: '11520' },
          { name: 'San Isidro', postalCode: '11518' },
          { name: 'Invivienda', postalCode: '11512' },
          { name: 'Los Corales del Sur', postalCode: '11603' },
          { name: 'Los Prados del Cachón', postalCode: '11517' },
        ],
      },
      {
        name: 'Santo Domingo Norte',
        code: '010300',
        postalCode: '11200',
        sectors: [
          { name: 'Villa Mella Centro', postalCode: '11201' },
          { name: 'Sabana Perdida', postalCode: '11202' },
          { name: 'Los Guaricanos', postalCode: '11203' },
          { name: 'El Higüero (SDN)', postalCode: '11204' },
          { name: 'Colinas del Viento', postalCode: '11205' },
        ],
      },
      {
        name: 'Santo Domingo Oeste',
        code: '010400',
        postalCode: '10700',
        sectors: [
          { name: 'Herrera', postalCode: '10701' },
          { name: 'Las Caobas (SDO)', postalCode: '10702' },
          { name: 'Bayona', postalCode: '10703' },
          { name: 'Manoguayabo', postalCode: '10704' },
          { name: 'El Café de Herrera', postalCode: '10705' },
        ],
      },
      {
        name: 'Boca Chica',
        code: '010500',
        postalCode: '11600',
        sectors: [
          { name: 'Boca Chica Centro', postalCode: '11601' },
          { name: 'Andrés', postalCode: '11602' },
          { name: 'La Caleta', postalCode: '11603' },
        ],
      },
      {
        name: 'Los Alcarrizos',
        code: '010600',
        postalCode: '10800',
        sectors: [
          { name: 'Los Alcarrizos Centro', postalCode: '10801' },
          { name: 'Palmarejo', postalCode: '10802' },
          { name: 'Pantoja', postalCode: '10803' },
        ],
      },
      {
        name: 'Pedro Brand',
        code: '010700',
        postalCode: '11900',
        sectors: [
          { name: 'Pedro Brand Centro', postalCode: '11901' },
          { name: 'La Guáyiga', postalCode: '11902' },
          { name: 'La Cuaba', postalCode: '11903' },
        ],
      },
      {
        name: 'San Antonio de Guerra',
        code: '010800',
        postalCode: '11700',
        sectors: [
          { name: 'Guerra Centro', postalCode: '11701' },
          { name: 'Hato Viejo', postalCode: '11702' },
        ],
      },
    ],
  },

  // ----------------------------------------------------------------------------
  // 4. SANTIAGO
  // ----------------------------------------------------------------------------
  {
    name: 'Santiago',
    code: 'STG',
    municipalities: [
      {
        name: 'Santiago de los Caballeros',
        code: '020100',
        postalCode: '51000',
        sectors: [
          { name: 'Gurabo', postalCode: '51052' },
          { name: 'Los Jardines', postalCode: '51021' },
          { name: 'Cerros de Gurabo', postalCode: '51051' },
          { name: 'Villa Olga', postalCode: '51024' },
          { name: 'El Embrujo', postalCode: '51025' },
          { name: 'La Trinitaria', postalCode: '51026' },
          { name: 'Cienfuegos', postalCode: '51031' },
          { name: 'Pekín', postalCode: '51041' },
        ],
      },
      { name: 'Bisonó (Navarrete)', code: '020200', postalCode: '51000', sectors: [{ name: 'Navarrete Centro' }] },
      { name: 'Jánico', code: '020300', postalCode: '51000', sectors: [{ name: 'Jánico Centro' }] },
      { name: 'Licey al Medio', code: '020400', postalCode: '51000', sectors: [{ name: 'Licey Centro' }] },
      { name: 'Puñal', code: '020500', postalCode: '51000', sectors: [{ name: 'Puñal Centro' }] },
      { name: 'Sabana Iglesia', code: '020600', postalCode: '51000', sectors: [{ name: 'Sabana Iglesia Centro' }] },
      { name: 'San José de las Matas', code: '020700', postalCode: '51000', sectors: [{ name: 'Sajoma Centro' }] },
      { name: 'Tamboril', code: '020800', postalCode: '51000', sectors: [{ name: 'Tamboril Centro' }] },
      { name: 'Villa González', code: '020900', postalCode: '51000', sectors: [{ name: 'Villa González Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 5. LA ALTAGRACIA
  // ----------------------------------------------------------------------------
  {
    name: 'La Altagracia',
    code: 'AL',
    municipalities: [
      {
        name: 'Higüey',
        code: '030100',
        postalCode: '23000',
        sectors: [
          { name: 'Higüey Centro', postalCode: '23001' },
          { name: 'Bávaro', postalCode: '23301' },
          { name: 'Punta Cana', postalCode: '23000' },
          { name: 'Verón', postalCode: '23302' },
          { name: 'Cap Cana', postalCode: '23000' },
          { name: 'Friusa', postalCode: '23301' },
          { name: 'Cortecito', postalCode: '23301' },
          { name: 'Los Corales (Bávaro)', postalCode: '23301' },
          { name: 'Cabeza de Toro', postalCode: '23000' },
        ],
      },
      {
        name: 'San Rafael del Yuma',
        code: '030200',
        postalCode: '23000',
        sectors: [
          { name: 'Yuma Centro' },
          { name: 'Bayahíbe', postalCode: '23000' },
          { name: 'Boca de Yuma', postalCode: '23000' },
        ],
      },
    ],
  },

  // ----------------------------------------------------------------------------
  // 6. PERAVIA (Baní)
  // ----------------------------------------------------------------------------
  {
    name: 'Peravia',
    code: 'PR',
    municipalities: [
      {
        name: 'Baní',
        code: '170100',
        postalCode: '94000',
        sectors: [
          { name: 'Baní Centro', postalCode: '94000' },
          { name: 'El Fundo', postalCode: '94000' },
          { name: 'Villa Majega', postalCode: '94000' },
          { name: 'Santa Rosa', postalCode: '94000' },
          { name: 'Sombrero', postalCode: '94000' },
          { name: 'Matanzas', postalCode: '94000' },
          { name: 'Salinas', postalCode: '94000' },
        ],
      },
      { name: 'Nizao', code: '170200', postalCode: '94000', sectors: [{ name: 'Nizao Centro' }, { name: 'Don Gregorio' }] },
      { name: 'Matanzas', code: '170300', postalCode: '94000', sectors: [{ name: 'Matanzas Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 7. SAN CRISTÓBAL
  // ----------------------------------------------------------------------------
  {
    name: 'San Cristóbal',
    code: 'SC',
    municipalities: [
      {
        name: 'San Cristóbal',
        code: '210100',
        postalCode: '91000',
        sectors: [
          { name: 'Centro San Cristóbal', postalCode: '91000' },
          { name: 'Madre Vieja Norte', postalCode: '91000' },
          { name: 'Madre Vieja Sur', postalCode: '91000' },
          { name: 'Pueblo Nuevo', postalCode: '91000' },
          { name: 'Lava Pies', postalCode: '91000' },
          { name: 'Hatillo (San Cristóbal)', postalCode: '91000' },
        ],
      },
      { name: 'Bajos de Haina', code: '210200', postalCode: '91000', sectors: [{ name: 'Haina Centro' }, { name: 'El Carril' }] },
      { name: 'San Gregorio de Nigua', code: '210300', postalCode: '91000', sectors: [{ name: 'Nigua Centro' }] },
      { name: 'Villa Altagracia', code: '210400', postalCode: '91000', sectors: [{ name: 'Villa Altagracia Centro' }] },
      { name: 'Yaguate', code: '210500', postalCode: '91000', sectors: [{ name: 'Yaguate Centro' }] },
      { name: 'Cambita Garabitos', code: '210600', postalCode: '91000', sectors: [{ name: 'Cambita Centro' }] },
      { name: 'Los Cacaos', code: '210700', postalCode: '91000', sectors: [{ name: 'Los Cacaos Centro' }] },
      { name: 'Sabana Grande de Palenque', code: '210800', postalCode: '91000', sectors: [{ name: 'Palenque Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 8. SAN JOSÉ DE OCOA
  // ----------------------------------------------------------------------------
  {
    name: 'San José de Ocoa',
    code: 'JO',
    municipalities: [
      { name: 'San José de Ocoa', code: '310100', postalCode: '93000', sectors: [{ name: 'Ocoa Centro' }, { name: 'Pueblo Arriba' }, { name: 'San Luis' }] },
      { name: 'Sabana Larga', code: '310200', postalCode: '93000', sectors: [{ name: 'Sabana Larga Centro' }] },
      { name: 'Rancho Arriba', code: '310300', postalCode: '93000', sectors: [{ name: 'Rancho Arriba Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 9. BARAHONA
  // ----------------------------------------------------------------------------
  {
    name: 'Barahona',
    code: 'BA',
    municipalities: [
      { name: 'Santa Cruz de Barahona', code: '030100', postalCode: '81000', sectors: [{ name: 'Barahona Centro' }, { name: 'Villa Central' }, { name: 'Palmarito' }] },
      { name: 'Cabral', code: '030200', postalCode: '81000', sectors: [{ name: 'Cabral Centro' }] },
      { name: 'Enriquillo', code: '030300', postalCode: '81000', sectors: [{ name: 'Enriquillo Centro' }] },
      { name: 'Paraíso', code: '030400', postalCode: '81000', sectors: [{ name: 'Paraíso Centro' }] },
      { name: 'Vicente Noble', code: '030500', postalCode: '81000', sectors: [{ name: 'Vicente Noble Centro' }] },
      { name: 'Polo', code: '030600', postalCode: '81000', sectors: [{ name: 'Polo Centro' }] },
      { name: 'Las Salinas', code: '030700', postalCode: '81000', sectors: [{ name: 'Salinas Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 10. SAN JUAN
  // ----------------------------------------------------------------------------
  {
    name: 'San Juan',
    code: 'SJ',
    municipalities: [
      { name: 'San Juan de la Maguana', code: '220100', postalCode: '72000', sectors: [{ name: 'San Juan Centro' }, { name: 'Villa Flores' }, { name: 'Córbano Sur' }] },
      { name: 'Las Matas de Farfán', code: '220200', postalCode: '72000', sectors: [{ name: 'Las Matas Centro' }] },
      { name: 'Bohechío', code: '220300', postalCode: '72000', sectors: [{ name: 'Bohechío Centro' }] },
      { name: 'El Cercado', code: '220400', postalCode: '72000', sectors: [{ name: 'El Cercado Centro' }] },
      { name: 'Juan de Herrera', code: '220500', postalCode: '72000', sectors: [{ name: 'Juan de Herrera Centro' }] },
      { name: 'Vallejuelo', code: '220600', postalCode: '72000', sectors: [{ name: 'Vallejuelo Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 11. BAORUCO
  // ----------------------------------------------------------------------------
  {
    name: 'Baoruco',
    code: 'BR',
    municipalities: [
      { name: 'Neiba', code: '040100', postalCode: '82000', sectors: [{ name: 'Neiba Centro' }] },
      { name: 'Galván', code: '040200', postalCode: '82000', sectors: [{ name: 'Galván Centro' }] },
      { name: 'Los Ríos', code: '040300', postalCode: '82000', sectors: [{ name: 'Los Ríos Centro' }] },
      { name: 'Tamayo', code: '040400', postalCode: '82000', sectors: [{ name: 'Tamayo Centro' }] },
      { name: 'Villa Jaragua', code: '040500', postalCode: '82000', sectors: [{ name: 'Jaragua Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 12. PEDERNALES
  // ----------------------------------------------------------------------------
  {
    name: 'Pedernales',
    code: 'PE',
    municipalities: [
      { name: 'Pedernales', code: '160100', postalCode: '84000', sectors: [{ name: 'Pedernales Centro' }, { name: 'Cabo Rojo' }] },
      { name: 'Oviedo', code: '160200', postalCode: '84000', sectors: [{ name: 'Oviedo Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 13. INDEPENDENCIA
  // ----------------------------------------------------------------------------
  {
    name: 'Independencia',
    code: 'IN',
    municipalities: [
      { name: 'Jimaní', code: '100100', postalCode: '83000', sectors: [{ name: 'Jimaní Centro' }] },
      { name: 'Duvergé', code: '100200', postalCode: '83000', sectors: [{ name: 'Duvergé Centro' }] },
      { name: 'La Descubierta', code: '100300', postalCode: '83000', sectors: [{ name: 'La Descubierta Centro' }] },
      { name: 'Postrer Río', code: '100400', postalCode: '83000', sectors: [{ name: 'Postrer Río Centro' }] },
      { name: 'Cristóbal', code: '100500', postalCode: '83000', sectors: [{ name: 'Cristóbal Centro' }] },
      { name: 'Mella', code: '100600', postalCode: '83000', sectors: [{ name: 'Mella Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 14. ELÍAS PIÑA
  // ----------------------------------------------------------------------------
  {
    name: 'Elías Piña',
    code: 'EP',
    municipalities: [
      { name: 'Comendador', code: '070100', postalCode: '73000', sectors: [{ name: 'Comendador Centro' }] },
      { name: 'Bánica', code: '070200', postalCode: '73000', sectors: [{ name: 'Bánica Centro' }] },
      { name: 'El Llano', code: '070300', postalCode: '73000', sectors: [{ name: 'El Llano Centro' }] },
      { name: 'Hondo Valle', code: '070400', postalCode: '73000', sectors: [{ name: 'Hondo Valle Centro' }] },
      { name: 'Juan Santiago', code: '070500', postalCode: '73000', sectors: [{ name: 'Juan Santiago Centro' }] },
      { name: 'Pedro Santana', code: '070600', postalCode: '73000', sectors: [{ name: 'Pedro Santana Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 15. LA VEGA
  // ----------------------------------------------------------------------------
  {
    name: 'La Vega',
    code: 'VE',
    municipalities: [
      { name: 'Concepción de La Vega', code: '130100', postalCode: '41000', sectors: [{ name: 'La Vega Centro' }, { name: 'Villa Rosa' }, { name: 'Palmarito' }] },
      { name: 'Constanza', code: '130200', postalCode: '41000', sectors: [{ name: 'Constanza Centro' }, { name: 'Tireo' }] },
      { name: 'Jarabacoa', code: '130300', postalCode: '41000', sectors: [{ name: 'Jarabacoa Centro' }, { name: 'Buena Vista' }] },
      { name: 'Jima Abajo', code: '130400', postalCode: '41000', sectors: [{ name: 'Jima Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 16. PUERTO PLATA
  // ----------------------------------------------------------------------------
  {
    name: 'Puerto Plata',
    code: 'PP',
    municipalities: [
      { name: 'San Felipe de Puerto Plata', code: '180100', postalCode: '57000', sectors: [{ name: 'Puerto Plata Centro' }, { name: 'Playa Dorada' }, { name: 'Costámbar' }] },
      { name: 'Sosúa', code: '180200', postalCode: '57000', sectors: [{ name: 'Sosúa Centro' }, { name: 'Cabarete' }] },
      { name: 'Altamira', code: '180300', postalCode: '57000', sectors: [{ name: 'Altamira Centro' }] },
      { name: 'Guananico', code: '180400', postalCode: '57000', sectors: [{ name: 'Guananico Centro' }] },
      { name: 'Imbert', code: '180500', postalCode: '57000', sectors: [{ name: 'Imbert Centro' }] },
      { name: 'Los Hidalgos', code: '180600', postalCode: '57000', sectors: [{ name: 'Los Hidalgos Centro' }] },
      { name: 'Luperón', code: '180700', postalCode: '57000', sectors: [{ name: 'Luperón Centro' }] },
      { name: 'Villa Isabela', code: '180800', postalCode: '57000', sectors: [{ name: 'Villa Isabela Centro' }] },
      { name: 'Villa Montellano', code: '180900', postalCode: '57000', sectors: [{ name: 'Montellano Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 17. DUARTE (San Francisco de Macorís)
  // ----------------------------------------------------------------------------
  {
    name: 'Duarte',
    code: 'DU',
    municipalities: [
      { name: 'San Francisco de Macorís', code: '060100', postalCode: '31000', sectors: [{ name: 'SFM Centro' }, { name: 'Ribera del Jaya' }, { name: 'Pueblo Nuevo' }] },
      { name: 'Arenoso', code: '060200', postalCode: '31000', sectors: [{ name: 'Arenoso Centro' }] },
      { name: 'Castillo', code: '060300', postalCode: '31000', sectors: [{ name: 'Castillo Centro' }] },
      { name: 'Eugenio María de Hostos', code: '060400', postalCode: '31000', sectors: [{ name: 'Hostos Centro' }] },
      { name: 'Las Guáranas', code: '060500', postalCode: '31000', sectors: [{ name: 'Las Guáranas Centro' }] },
      { name: 'Pimentel', code: '060600', postalCode: '31000', sectors: [{ name: 'Pimentel Centro' }] },
      { name: 'Villa Riva', code: '060700', postalCode: '31000', sectors: [{ name: 'Villa Riva Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 18. ESPAILLAT (Moca)
  // ----------------------------------------------------------------------------
  {
    name: 'Espaillat',
    code: 'ES',
    municipalities: [
      { name: 'Moca', code: '080100', postalCode: '56000', sectors: [{ name: 'Moca Centro' }, { name: 'La Española' }, { name: 'Barrio Nuevo' }] },
      { name: 'Cayetano Germosén', code: '080200', postalCode: '56000', sectors: [{ name: 'Cayetano Centro' }] },
      { name: 'Gaspar Hernández', code: '080300', postalCode: '56000', sectors: [{ name: 'Gaspar Hernández Centro' }] },
      { name: 'Jamao al Norte', code: '080400', postalCode: '56000', sectors: [{ name: 'Jamao Centro' }] },
      { name: 'San Víctor', code: '080500', postalCode: '56000', sectors: [{ name: 'San Víctor Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 19. MONSEÑOR NOUEL (Bonao)
  // ----------------------------------------------------------------------------
  {
    name: 'Monseñor Nouel',
    code: 'MN',
    municipalities: [
      { name: 'Bonao', code: '140100', postalCode: '42000', sectors: [{ name: 'Bonao Centro' }, { name: 'Los Quemados' }, { name: 'Juma Bejucal' }] },
      { name: 'Maimón', code: '140200', postalCode: '42000', sectors: [{ name: 'Maimón Centro' }] },
      { name: 'Piedra Blanca', code: '140300', postalCode: '42000', sectors: [{ name: 'Piedra Blanca Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 20. SÁNCHEZ RAMÍREZ (Cotuí)
  // ----------------------------------------------------------------------------
  {
    name: 'Sánchez Ramírez',
    code: 'SR',
    municipalities: [
      { name: 'Cotuí', code: '240100', postalCode: '43000', sectors: [{ name: 'Cotuí Centro' }, { name: 'Quita Sueño' }] },
      { name: 'Cevicos', code: '240200', postalCode: '43000', sectors: [{ name: 'Cevicos Centro' }] },
      { name: 'Fantino', code: '240300', postalCode: '43000', sectors: [{ name: 'Fantino Centro' }] },
      { name: 'La Mata', code: '240400', postalCode: '43000', sectors: [{ name: 'La Mata Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 21. HERMANAS MIRABAL (Salcedo)
  // ----------------------------------------------------------------------------
  {
    name: 'Hermanas Mirabal',
    code: 'HM',
    municipalities: [
      { name: 'Salcedo', code: '090100', postalCode: '34000', sectors: [{ name: 'Salcedo Centro' }] },
      { name: 'Tenares', code: '090200', postalCode: '34000', sectors: [{ name: 'Tenares Centro' }] },
      { name: 'Villa Tapia', code: '090300', postalCode: '34000', sectors: [{ name: 'Villa Tapia Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 22. MARÍA TRINIDAD SÁNCHEZ (Nagua)
  // ----------------------------------------------------------------------------
  {
    name: 'María Trinidad Sánchez',
    code: 'MT',
    municipalities: [
      { name: 'Nagua', code: '120100', postalCode: '33000', sectors: [{ name: 'Nagua Centro' }, { name: 'Matancitas' }] },
      { name: 'Cabrera', code: '120200', postalCode: '33000', sectors: [{ name: 'Cabrera Centro' }] },
      { name: 'El Factor', code: '120300', postalCode: '33000', sectors: [{ name: 'El Factor Centro' }] },
      { name: 'Río San Juan', code: '120400', postalCode: '33000', sectors: [{ name: 'Río San Juan Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 23. SAMANÁ
  // ----------------------------------------------------------------------------
  {
    name: 'Samaná',
    code: 'SM',
    municipalities: [
      { name: 'Santa Bárbara de Samaná', code: '200100', postalCode: '32000', sectors: [{ name: 'Samaná Centro' }] },
      { name: 'Las Terrenas', code: '200200', postalCode: '32000', sectors: [{ name: 'Las Terrenas Centro' }, { name: 'Punta Popy' }] },
      { name: 'Sánchez', code: '200300', postalCode: '32000', sectors: [{ name: 'Sánchez Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 24. MONTE PLATA
  // ----------------------------------------------------------------------------
  {
    name: 'Monte Plata',
    code: 'MP',
    municipalities: [
      { name: 'Monte Plata', code: '150100', postalCode: '92000', sectors: [{ name: 'Monte Plata Centro' }] },
      { name: 'Bayaguana', code: '150200', postalCode: '92000', sectors: [{ name: 'Bayaguana Centro' }] },
      { name: 'Peralvillo', code: '150300', postalCode: '92000', sectors: [{ name: 'Peralvillo Centro' }] },
      { name: 'Sabana Grande de Boyá', code: '150400', postalCode: '92000', sectors: [{ name: 'Boyá Centro' }] },
      { name: 'Yamasá', code: '150500', postalCode: '92000', sectors: [{ name: 'Yamasá Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 25. HATO MAYOR
  // ----------------------------------------------------------------------------
  {
    name: 'Hato Mayor',
    code: 'HMA',
    municipalities: [
      { name: 'Hato Mayor del Rey', code: '080100', postalCode: '25000', sectors: [{ name: 'Hato Mayor Centro' }] },
      { name: 'El Valle', code: '080200', postalCode: '25000', sectors: [{ name: 'El Valle Centro' }] },
      { name: 'Sabana de la Mar', code: '080300', postalCode: '25000', sectors: [{ name: 'Sabana de la Mar Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 26. EL SEIBO
  // ----------------------------------------------------------------------------
  {
    name: 'El Seibo',
    code: 'SE',
    municipalities: [
      { name: 'Santa Cruz de El Seibo', code: '080100', postalCode: '24000', sectors: [{ name: 'El Seibo Centro' }] },
      { name: 'Miches', code: '080200', postalCode: '24000', sectors: [{ name: 'Miches Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 27. SAN PEDRO DE MACORÍS
  // ----------------------------------------------------------------------------
  {
    name: 'San Pedro de Macorís',
    code: 'PM',
    municipalities: [
      { name: 'San Pedro de Macorís', code: '230100', postalCode: '21000', sectors: [{ name: 'SPM Centro' }, { name: 'Miramar' }, { name: 'Barrio Lindo' }] },
      { name: 'Consuelo', code: '230200', postalCode: '21000', sectors: [{ name: 'Consuelo Centro' }] },
      { name: 'Guayacanes', code: '230300', postalCode: '21000', sectors: [{ name: 'Juan Dolio' }, { name: 'Guayacanes Centro' }] },
      { name: 'Quisqueya (SPM)', code: '230400', postalCode: '21000', sectors: [{ name: 'Quisqueya Centro' }] },
      { name: 'Ramón Santana', code: '230500', postalCode: '21000', sectors: [{ name: 'Ramón Santana Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 28. LA ROMANA
  // ----------------------------------------------------------------------------
  {
    name: 'La Romana',
    code: 'RO',
    municipalities: [
      { name: 'La Romana', code: '110100', postalCode: '22000', sectors: [{ name: 'La Romana Centro' }, { name: 'Casa de Campo' }, { name: 'Buena Vista' }] },
      { name: 'Guaymate', code: '110200', postalCode: '22000', sectors: [{ name: 'Guaymate Centro' }] },
      { name: 'Villa Hermosa', code: '110300', postalCode: '22000', sectors: [{ name: 'Villa Hermosa Centro' }, { name: 'Cumayasa' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 29. MONTE CRISTI
  // ----------------------------------------------------------------------------
  {
    name: 'Monte Cristi',
    code: 'MC',
    municipalities: [
      { name: 'San Fernando de Monte Cristi', code: '140100', postalCode: '62000', sectors: [{ name: 'Monte Cristi Centro' }] },
      { name: 'Castañuelas', code: '140200', postalCode: '62000', sectors: [{ name: 'Castañuelas Centro' }] },
      { name: 'Guayubín', code: '140300', postalCode: '62000', sectors: [{ name: 'Guayubín Centro' }] },
      { name: 'Las Matas de Santa Cruz', code: '140400', postalCode: '62000', sectors: [{ name: 'Las Matas Centro' }] },
      { name: 'Pepillo Salcedo (Manzanillo)', code: '140500', postalCode: '62000', sectors: [{ name: 'Manzanillo Centro' }] },
      { name: 'Villa Vásquez', code: '140600', postalCode: '62000', sectors: [{ name: 'Villa Vásquez Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 30. DAJABÓN
  // ----------------------------------------------------------------------------
  {
    name: 'Dajabón',
    code: 'DA',
    municipalities: [
      { name: 'Dajabón', code: '050100', postalCode: '63000', sectors: [{ name: 'Dajabón Centro' }] },
      { name: 'El Pino', code: '050200', postalCode: '63000', sectors: [{ name: 'El Pino Centro' }] },
      { name: 'Loma de Cabrera', code: '050300', postalCode: '63000', sectors: [{ name: 'Loma de Cabrera Centro' }] },
      { name: 'Partido', code: '050400', postalCode: '63000', sectors: [{ name: 'Partido Centro' }] },
      { name: 'Restauración', code: '050500', postalCode: '63000', sectors: [{ name: 'Restauración Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 31. SANTIAGO RODRÍGUEZ
  // ----------------------------------------------------------------------------
  {
    name: 'Santiago Rodríguez',
    code: 'STR',
    municipalities: [
      { name: 'San Ignacio de Sabaneta', code: '260100', postalCode: '68000', sectors: [{ name: 'Sabaneta Centro' }] },
      { name: 'Monción', code: '260200', postalCode: '68000', sectors: [{ name: 'Monción Centro' }] },
      { name: 'Villa Los Almácigos', code: '260300', postalCode: '68000', sectors: [{ name: 'Los Almácigos Centro' }] },
    ],
  },

  // ----------------------------------------------------------------------------
  // 32. VALVERDE (Mao)
  // ----------------------------------------------------------------------------
  {
    name: 'Valverde',
    code: 'VA',
    municipalities: [
      { name: 'Santa Cruz de Mao', code: '270100', postalCode: '61000', sectors: [{ name: 'Mao Centro' }, { name: 'Hatico' }] },
      { name: 'Esperanza', code: '270200', postalCode: '61000', sectors: [{ name: 'Esperanza Centro' }] },
      { name: 'Laguna Salada', code: '270300', postalCode: '61000', sectors: [{ name: 'Laguna Salada Centro' }] },
    ],
  },
];

export async function runGeographySeed() {
  console.log('🇩🇴 ==============================================================================');
  console.log('🇩🇴 INICIANDO SEMILLERO GEOGRÁFICO NACIONAL DE LA REPÚBLICA DOMINICANA');
  console.log('🇩🇴 Cobertura: 32 Provincias oficiales, municipios y sectores estratégicos');
  console.log('🇩🇴 ==============================================================================');

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const countryRepo = AppDataSource.getRepository(CountryEntity);
  const provinceRepo = AppDataSource.getRepository(ProvinceEntity);
  const municipalityRepo = AppDataSource.getRepository(MunicipalityEntity);
  const sectorRepo = AppDataSource.getRepository(SectorEntity);

  // 1. País: República Dominicana
  let country = await countryRepo.findOneBy({ code: 'DOM' });
  if (!country) {
    country = countryRepo.create({
      code: 'DOM',
      name: 'República Dominicana',
      phoneCode: '+1',
      isActive: true,
    });
    country = await countryRepo.save(country);
    console.log('✅ País registrado: República Dominicana (DOM)');
  } else {
    console.log('ℹ️  País ya existente: República Dominicana (DOM)');
  }

  let totalProvincesCreated = 0;
  let totalMunicipalitiesCreated = 0;
  let totalSectorsCreated = 0;

  for (const provData of DOMINICAN_REPUBLIC_GEO_DATA) {
    let province = await provinceRepo.findOneBy({
      countryId: country.id,
      name: provData.name,
    });

    if (!province) {
      province = provinceRepo.create({
        countryId: country.id,
        name: provData.name,
        code: provData.code,
        isActive: true,
      });
      province = await provinceRepo.save(province);
      totalProvincesCreated++;
    } else if (!province.code && provData.code) {
      province.code = provData.code;
      await provinceRepo.save(province);
    }

    for (const munData of provData.municipalities) {
      let municipality = await municipalityRepo.findOneBy({
        provinceId: province.id,
        name: munData.name,
      });

      if (!municipality) {
        municipality = municipalityRepo.create({
          provinceId: province.id,
          name: munData.name,
          code: munData.code,
          postalCode: munData.postalCode,
          isActive: true,
        });
        municipality = await municipalityRepo.save(municipality);
        totalMunicipalitiesCreated++;
      } else {
        // Actualizar código postal o código si faltaba
        let needsUpdate = false;
        if (!municipality.postalCode && munData.postalCode) {
          municipality.postalCode = munData.postalCode;
          needsUpdate = true;
        }
        if (!municipality.code && munData.code) {
          municipality.code = munData.code;
          needsUpdate = true;
        }
        if (needsUpdate) {
          await municipalityRepo.save(municipality);
        }
      }

      if (munData.sectors && munData.sectors.length > 0) {
        for (const secData of munData.sectors) {
          let sector = await sectorRepo.findOneBy({
            municipalityId: municipality.id,
            name: secData.name,
          });

          if (!sector) {
            sector = sectorRepo.create({
              municipalityId: municipality.id,
              name: secData.name,
              postalCode: secData.postalCode || municipality.postalCode,
              isActive: true,
            });
            await sectorRepo.save(sector);
            totalSectorsCreated++;
          }
        }
      }
    }
  }

  const finalProvincesCount = await provinceRepo.count();
  const finalMunicipalitiesCount = await municipalityRepo.count();
  const finalSectorsCount = await sectorRepo.count();

  console.log('📊 RESUMEN DE POBLACIÓN GEOGRÁFICA:');
  console.log(`   - Provincias nuevas insertadas: ${totalProvincesCreated}`);
  console.log(`   - Municipios nuevos insertados: ${totalMunicipalitiesCreated}`);
  console.log(`   - Sectores nuevos insertados:   ${totalSectorsCreated}`);
  console.log('📈 TOTALES EN BASE DE DATOS:');
  console.log(`   - Total Provincias:   ${finalProvincesCount} (de 32 oficiales)`);
  console.log(`   - Total Municipios:   ${finalMunicipalitiesCount}`);
  console.log(`   - Total Sectores:     ${finalSectorsCount}`);
  console.log('✨ ==============================================================================');
  console.log('✨ SEMILLERO GEOGRÁFICO DE REPÚBLICA DOMINICANA COMPLETADO EXITOSAMENTE');
  console.log('✨ ==============================================================================');
}

if (require.main === module) {
  runGeographySeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error ejecutando semillero geográfico:', err);
      process.exit(1);
    });
}
