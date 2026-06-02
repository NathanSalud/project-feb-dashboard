import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

export interface User {
  username: string;
  companyName: string;
  accountNames: string[];
  platforms: string[];
  isAdmin: boolean;
}

const HASH = '$2b$10$gYWxcBc5qepP9lKBdNJv3uovaRzQH3UHhDG6YcQ9ZoPun4cBIQn9C';

const USERS: { username: string; passwordHash: string; user: User }[] = [
  {
    username: 'gdec_admin',
    passwordHash: HASH,
    user: {
      username: 'gdec_admin',
      companyName: 'GDEC Admin',
      accountNames: [],
      platforms: [],
      isAdmin: true,
    },
  },
  {
    username: 'alaska_milk_corporation',
    passwordHash: HASH,
    user: {
      username: 'alaska_milk_corporation',
      companyName: 'Alaska Milk Corporation',
      accountNames: ['Alaska'],
      platforms: ['Lazada', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'ardent_world_inc',
    passwordHash: HASH,
    user: {
      username: 'ardent_world_inc',
      companyName: 'Ardent World Inc.',
      accountNames: ['Ardent World'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'bayer_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'bayer_philippines_inc',
      companyName: 'Bayer Philippines, Inc.',
      accountNames: ['Bayer Consumer Health'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'beiersdorf_philippines_incorporated',
    passwordHash: HASH,
    user: {
      username: 'beiersdorf_philippines_incorporated',
      companyName: 'Beiersdorf Philippines Incorporated',
      accountNames: ['Nivea', 'Nivea Wholesale'],
      platforms: ['Lazada', 'Shopee', 'Tiktok', 'Zalora'],
      isAdmin: false,
    },
  },
  {
    username: 'benby_enterprises_inc',
    passwordHash: HASH,
    user: {
      username: 'benby_enterprises_inc',
      companyName: 'Benby Enterprises, Inc.',
      accountNames: ['Pedigree'],
      platforms: ['Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'c_scor_global_intertrade_corp',
    passwordHash: HASH,
    user: {
      username: 'c_scor_global_intertrade_corp',
      companyName: `C'scor Global Intertrade Corp.`,
      accountNames: ['Buds & Blooms', 'Dentiste', 'Tiny Buds'],
      platforms: ['Lazada', 'Shopee'],
      isAdmin: false,
    },
  },
  {
    username: 'century_pacific_food_inc',
    passwordHash: HASH,
    user: {
      username: 'century_pacific_food_inc',
      companyName: 'Century Pacific Food Inc',
      accountNames: ['Birch Tree Advance', 'Century Pacific Foods Inc.'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'del_monte_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'del_monte_philippines_inc',
      companyName: 'Del Monte Philippines, Inc.',
      accountNames: ['Del Monte'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'diageo_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'diageo_philippines_inc',
      companyName: 'Diageo Philippines Inc.',
      accountNames: ['Diageo'],
      platforms: ['Lazada', 'Shopee'],
      isAdmin: false,
    },
  },
  {
    username: 'earth_homecare_products_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'earth_homecare_products_philippines_inc',
      companyName: 'Earth Homecare Products (Philippines), Inc.',
      accountNames: ['Earth Homecare Products'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'fonterra_brands_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'fonterra_brands_philippines_inc',
      companyName: 'Fonterra Brands Philippines, Inc.',
      accountNames: ['Fonterra'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'found_young_corp',
    passwordHash: HASH,
    user: {
      username: 'found_young_corp',
      companyName: 'Found Young Corp',
      accountNames: ['7LUXE'],
      platforms: ['Shopee'],
      isAdmin: false,
    },
  },
  {
    username: 'general_odyssey_inc',
    passwordHash: HASH,
    user: {
      username: 'general_odyssey_inc',
      companyName: 'General Odyssey Inc.',
      accountNames: ['Goodest'],
      platforms: ['Lazada', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'genson_distribution_inc',
    passwordHash: HASH,
    user: {
      username: 'genson_distribution_inc',
      companyName: 'Genson Distribution Inc.',
      accountNames: ['Beauty Avenue PH', 'Beauty Avenue Ph'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'glaxosmithkline_consumer_healthcare_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'glaxosmithkline_consumer_healthcare_philippines_inc',
      companyName: 'Glaxosmithkline Consumer Healthcare Philippines Inc.',
      accountNames: ['Haleon'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'green_cross_inc',
    passwordHash: HASH,
    user: {
      username: 'green_cross_inc',
      companyName: 'Green Cross, Inc.',
      accountNames: ['Green Cross'],
      platforms: ['Lazada', 'Shopee'],
      isAdmin: false,
    },
  },
  {
    username: 'js_unitrade_merchandise_inc',
    passwordHash: HASH,
    user: {
      username: 'js_unitrade_merchandise_inc',
      companyName: 'JS Unitrade Merchandise, Inc.',
      accountNames: ['Charmee', 'EQ', 'Hygiene Hub', 'JS Unitrade Adult Care'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'liwayway_marketing_corporation',
    passwordHash: HASH,
    user: {
      username: 'liwayway_marketing_corporation',
      companyName: 'Liwayway Marketing Corporation',
      accountNames: ['Oishi'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'mega_global_corporation',
    passwordHash: HASH,
    user: {
      username: 'mega_global_corporation',
      companyName: 'Mega Global Corporation',
      accountNames: ['Mega Global Corporation'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'nutec_feeds_solutions_inc',
    passwordHash: HASH,
    user: {
      username: 'nutec_feeds_solutions_inc',
      companyName: 'NUTEC Feeds & Solutions Inc',
      accountNames: ['NUPEC'],
      platforms: ['Shopee'],
      isAdmin: false,
    },
  },
  {
    username: 'nestlé_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'nestlé_philippines_inc',
      companyName: 'Nestlé Philippines, Inc.',
      accountNames: ['Nestlé Health Science', 'Nestlé Official Store', 'Nestlé Official Store (Mindanao)', 'Nestlé Official Store (Visayas)', 'Nestlé Purina'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'nutri-asia_inc',
    passwordHash: HASH,
    user: {
      username: 'nutri-asia_inc',
      companyName: 'Nutri-Asia Inc.',
      accountNames: ['NutriAsia', 'Nutriasia'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'one_stop_distribution_inc',
    passwordHash: HASH,
    user: {
      username: 'one_stop_distribution_inc',
      companyName: 'One Stop Distribution Inc.',
      accountNames: ['Goo.N'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'perfetti_van_melle_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'perfetti_van_melle_philippines_inc',
      companyName: 'Perfetti Van Melle Philippines, Inc.',
      accountNames: ['Mentos and Chupa Chups'],
      platforms: ['Lazada', 'Shopee'],
      isAdmin: false,
    },
  },
  {
    username: 'personal_collection_direct_selling_inc',
    passwordHash: HASH,
    user: {
      username: 'personal_collection_direct_selling_inc',
      companyName: 'Personal Collection Direct Selling Inc.',
      accountNames: ['Personal Collection'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'pilipinas_shell_petroleum_corporation',
    passwordHash: HASH,
    user: {
      username: 'pilipinas_shell_petroleum_corporation',
      companyName: 'Pilipinas Shell Petroleum Corporation',
      accountNames: ['Shell'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'procter_gamble_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'procter_gamble_philippines_inc',
      companyName: 'Procter & Gamble Philippines, Inc.',
      accountNames: ['P&G Beauty', 'P&G Health', 'P&G Home Care', 'P&G Olay', 'P&G Pampers'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'reckitt_benckiser_healthcare_philippines',
    passwordHash: HASH,
    user: {
      username: 'reckitt_benckiser_healthcare_philippines',
      companyName: 'Reckitt Benckiser Healthcare Philippines',
      accountNames: ['Reckitt Health & Beauty', 'Reckitt Wellness'],
      platforms: ['Lazada'],
      isAdmin: false,
    },
  },
  {
    username: 'royal_canin_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'royal_canin_philippines_inc',
      companyName: 'Royal Canin Philippines, Inc.',
      accountNames: ['Royal Canin'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'rustan_marketing_corporation',
    passwordHash: HASH,
    user: {
      username: 'rustan_marketing_corporation',
      companyName: 'Rustan Marketing Corporation',
      accountNames: ['Easy Spirit', 'Hanes', 'High Sierra', 'KitchenAid', 'Lacoste Fragrance', 'Maidenform', 'Nuxe', 'OPI Philippines', 'Tefal Cookware Philippines'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 's_c_johnson_son_inc',
    passwordHash: HASH,
    user: {
      username: 's_c_johnson_son_inc',
      companyName: 'S.C. Johnson & Son, Inc.',
      accountNames: ['SC Johnson'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'samsonite_philippines_inc',
    passwordHash: HASH,
    user: {
      username: 'samsonite_philippines_inc',
      companyName: 'Samsonite Philippines Inc.',
      accountNames: ['American Tourister', 'Samsonite Red'],
      platforms: ['Lazada', 'Shopee', 'Zalora'],
      isAdmin: false,
    },
  },
  {
    username: 'san_miguel_foods_inc',
    passwordHash: HASH,
    user: {
      username: 'san_miguel_foods_inc',
      companyName: 'San Miguel Foods, Inc.',
      accountNames: ['San Miguel Animal Health & Pet Care', 'San Miguel Coffee', 'San Miguel Foods', 'San Miguel Frozen'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'splash_corporation',
    passwordHash: HASH,
    user: {
      username: 'splash_corporation',
      companyName: 'Splash Corporation',
      accountNames: ['Splash Personal Care'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'steve_sy',
    passwordHash: HASH,
    user: {
      username: 'steve_sy',
      companyName: 'Steve Sy',
      accountNames: ['Book Store by Sir Steve'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'sysu_international_inc',
    passwordHash: HASH,
    user: {
      username: 'sysu_international_inc',
      companyName: 'Sysu International Inc.',
      accountNames: ['Lee Kum Kee'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'tip_top_distribution_inc',
    passwordHash: HASH,
    user: {
      username: 'tip_top_distribution_inc',
      companyName: 'Tip Top Distribution, Inc',
      accountNames: ['Ovaltine', 'Twinings'],
      platforms: ['Lazada', 'Shopee', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'unicharm_philippines_corp',
    passwordHash: HASH,
    user: {
      username: 'unicharm_philippines_corp',
      companyName: 'Unicharm Philippines Corp.',
      accountNames: ['Certainty', 'MamyPoko', 'Sofy'],
      platforms: ['Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'unioil_lubricants_inc',
    passwordHash: HASH,
    user: {
      username: 'unioil_lubricants_inc',
      companyName: 'Unioil Lubricants Inc',
      accountNames: ['Idemitsu', 'Repsol', 'Unioil'],
      platforms: ['Lazada', 'Shopee'],
      isAdmin: false,
    },
  },
  {
    username: 'universal_robina_corporation',
    passwordHash: HASH,
    user: {
      username: 'universal_robina_corporation',
      companyName: 'Universal Robina Corporation',
      accountNames: ['URC'],
      platforms: ['Lazada', 'Tiktok'],
      isAdmin: false,
    },
  },
  {
    username: 'valiant_distribution_inc_kellanova',
    passwordHash: HASH,
    user: {
      username: 'valiant_distribution_inc_kellanova',
      companyName: 'Valiant Distribution, Inc. (Kellanova)',
      accountNames: ['Kellanova'],
      platforms: ['Lazada', 'Shopee'],
      isAdmin: false,
    },
  },
  {
    username: 'wyeth_nutrition_philippines',
    passwordHash: HASH,
    user: {
      username: 'wyeth_nutrition_philippines',
      companyName: 'Wyeth Nutrition Philippines',
      accountNames: ['Nestlé & Wyeth Nutrition'],
      platforms: ['Lazada', 'Shopee'],
      isAdmin: false,
    },
  },
  {
    username: 'zuellig_pharma_corporation',
    passwordHash: HASH,
    user: {
      username: 'zuellig_pharma_corporation',
      companyName: 'Zuellig Pharma Corporation',
      accountNames: ['Lysol Philippines'],
      platforms: ['Lazada'],
      isAdmin: false,
    },
  },
];

@Injectable()
export class AuthService {
  constructor(private jwt: JwtService) {}

  async login(username: string, password: string) {
    const record = USERS.find(u => u.username === username.toLowerCase());
    if (!record) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, record.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const payload = {
      username:     record.user.username,
      companyName:  record.user.companyName,
      accountNames: record.user.accountNames,
      platforms:    record.user.platforms,
      isAdmin:      record.user.isAdmin,
    };

    return {
      access_token: this.jwt.sign(payload),
      user: payload,
    };
  }
}
