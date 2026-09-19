--liquibase formatted sql

-- Backfill the Home/"Meine Daten" dropdown options (entity="users") for every existing org — new
-- orgs get this seeded at registration time instead (see basicdata-static-data.ts and
-- auth.controller.ts register()). Values/translation JSON here must stay in sync with that file.

--changeset worktime:060-seed-locales-static-data
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT id, 'users', 'locales',
  '{"en":"English","de":"Deutsch","fr":"Français","it":"Italiano"}'::jsonb,
  '{"en":{"en":"English","de":"German","fr":"French","it":"Italian"},
    "de":{"en":"Englisch","de":"Deutsch","fr":"Französisch","it":"Italienisch"},
    "fr":{"en":"Anglais","de":"Allemand","fr":"Français","it":"Italien"},
    "it":{"en":"Inglese","de":"Tedesco","fr":"Francese","it":"Italiano"}}'::jsonb
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM static_data sd WHERE sd.organization_id = o.id AND sd.entity = 'users' AND sd.enum_name = 'locales'
);

--changeset worktime:061-seed-nations-countries-static-data splitStatements:false
DO $$
DECLARE
  country_values jsonb := '{"CH":"Switzerland","DE":"Germany","AT":"Austria","FR":"France","IT":"Italy","LI":"Liechtenstein","GB":"United Kingdom","IE":"Ireland","NL":"Netherlands","BE":"Belgium","LU":"Luxembourg","ES":"Spain","PT":"Portugal","AD":"Andorra","MC":"Monaco","SM":"San Marino","VA":"Vatican City","MT":"Malta","DK":"Denmark","SE":"Sweden","NO":"Norway","FI":"Finland","IS":"Iceland","PL":"Poland","CZ":"Czechia","SK":"Slovakia","HU":"Hungary","SI":"Slovenia","HR":"Croatia","BA":"Bosnia and Herzegovina","RS":"Serbia","ME":"Montenegro","MK":"North Macedonia","AL":"Albania","XK":"Kosovo","RO":"Romania","BG":"Bulgaria","GR":"Greece","CY":"Cyprus","EE":"Estonia","LV":"Latvia","LT":"Lithuania","RU":"Russia","UA":"Ukraine","BY":"Belarus","MD":"Moldova","TR":"Turkey","GE":"Georgia","AM":"Armenia","AZ":"Azerbaijan","US":"United States","CA":"Canada","MX":"Mexico","BR":"Brazil","AR":"Argentina","CL":"Chile","CO":"Colombia","PE":"Peru","VE":"Venezuela","EC":"Ecuador","BO":"Bolivia","UY":"Uruguay","PY":"Paraguay","CN":"China","JP":"Japan","KR":"South Korea","KP":"North Korea","IN":"India","PK":"Pakistan","BD":"Bangladesh","LK":"Sri Lanka","NP":"Nepal","ID":"Indonesia","MY":"Malaysia","SG":"Singapore","TH":"Thailand","VN":"Vietnam","PH":"Philippines","MM":"Myanmar","KH":"Cambodia","LA":"Laos","MN":"Mongolia","KZ":"Kazakhstan","UZ":"Uzbekistan","AU":"Australia","NZ":"New Zealand","EG":"Egypt","MA":"Morocco","DZ":"Algeria","TN":"Tunisia","LY":"Libya","ZA":"South Africa","NG":"Nigeria","KE":"Kenya","ET":"Ethiopia","GH":"Ghana","SN":"Senegal","CI":"Côte d''Ivoire","CM":"Cameroon","AO":"Angola","MZ":"Mozambique","ZM":"Zambia","ZW":"Zimbabwe","TZ":"Tanzania","UG":"Uganda","SA":"Saudi Arabia","AE":"United Arab Emirates","IL":"Israel","IR":"Iran","IQ":"Iraq","JO":"Jordan","LB":"Lebanon","SY":"Syria","QA":"Qatar","KW":"Kuwait","OM":"Oman","YE":"Yemen","AF":"Afghanistan","CU":"Cuba","JM":"Jamaica","DO":"Dominican Republic","HT":"Haiti","CR":"Costa Rica","PA":"Panama","GT":"Guatemala","HN":"Honduras","SV":"El Salvador","NI":"Nicaragua"}';
  country_translation jsonb := '{"de":{"CH":"Schweiz","DE":"Deutschland","AT":"Österreich","FR":"Frankreich","IT":"Italien","LI":"Liechtenstein","GB":"Vereinigtes Königreich","IE":"Irland","NL":"Niederlande","BE":"Belgien","LU":"Luxemburg","ES":"Spanien","PT":"Portugal","AD":"Andorra","MC":"Monaco","SM":"San Marino","VA":"Vatikanstadt","MT":"Malta","DK":"Dänemark","SE":"Schweden","NO":"Norwegen","FI":"Finnland","IS":"Island","PL":"Polen","CZ":"Tschechien","SK":"Slowakei","HU":"Ungarn","SI":"Slowenien","HR":"Kroatien","BA":"Bosnien und Herzegowina","RS":"Serbien","ME":"Montenegro","MK":"Nordmazedonien","AL":"Albanien","XK":"Kosovo","RO":"Rumänien","BG":"Bulgarien","GR":"Griechenland","CY":"Zypern","EE":"Estland","LV":"Lettland","LT":"Litauen","RU":"Russland","UA":"Ukraine","BY":"Weissrussland","MD":"Moldau","TR":"Türkei","GE":"Georgien","AM":"Armenien","AZ":"Aserbaidschan","US":"Vereinigte Staaten","CA":"Kanada","MX":"Mexiko","BR":"Brasilien","AR":"Argentinien","CL":"Chile","CO":"Kolumbien","PE":"Peru","VE":"Venezuela","EC":"Ecuador","BO":"Bolivien","UY":"Uruguay","PY":"Paraguay","CN":"China","JP":"Japan","KR":"Südkorea","KP":"Nordkorea","IN":"Indien","PK":"Pakistan","BD":"Bangladesch","LK":"Sri Lanka","NP":"Nepal","ID":"Indonesien","MY":"Malaysia","SG":"Singapur","TH":"Thailand","VN":"Vietnam","PH":"Philippinen","MM":"Myanmar","KH":"Kambodscha","LA":"Laos","MN":"Mongolei","KZ":"Kasachstan","UZ":"Usbekistan","AU":"Australien","NZ":"Neuseeland","EG":"Ägypten","MA":"Marokko","DZ":"Algerien","TN":"Tunesien","LY":"Libyen","ZA":"Südafrika","NG":"Nigeria","KE":"Kenia","ET":"Äthiopien","GH":"Ghana","SN":"Senegal","CI":"Elfenbeinküste","CM":"Kamerun","AO":"Angola","MZ":"Mosambik","ZM":"Sambia","ZW":"Simbabwe","TZ":"Tansania","UG":"Uganda","SA":"Saudi-Arabien","AE":"Vereinigte Arabische Emirate","IL":"Israel","IR":"Iran","IQ":"Irak","JO":"Jordanien","LB":"Libanon","SY":"Syrien","QA":"Katar","KW":"Kuwait","OM":"Oman","YE":"Jemen","AF":"Afghanistan","CU":"Kuba","JM":"Jamaika","DO":"Dominikanische Republik","HT":"Haiti","CR":"Costa Rica","PA":"Panama","GT":"Guatemala","HN":"Honduras","SV":"El Salvador","NI":"Nicaragua"}}';
BEGIN
  INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
  SELECT o.id, 'users', enum_name, country_values, country_translation
  FROM organizations o
  CROSS JOIN (VALUES ('nations'), ('countries')) AS e(enum_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM static_data sd WHERE sd.organization_id = o.id AND sd.entity = 'users' AND sd.enum_name = e.enum_name
  );
END $$;
