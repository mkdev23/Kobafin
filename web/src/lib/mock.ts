export type Pot = {
  id: string;
  title: string;
  subtitle: string;
  targetUsd?: number;
  apr?: number;
  durationMonths?: number;
  color?: "blue" | "slate";
};

export const myPots: Pot[] = [
  {
    id: "christx",
    title: "Christx Foundation",
    subtitle: "Lower Fairfax, FC",
    targetUsd: 10000,
    durationMonths: 6,
    color: "blue",
  },
  {
    id: "emergency",
    title: "Emergency Fund",
    subtitle: "Personal",
    targetUsd: 2000,
    durationMonths: 3,
    color: "slate",
  },
];

export const recommendedPots: Pot[] = [
  {
    id: "rent",
    title: "Rent Saver",
    subtitle: "Monthly essentials",
    apr: 10,
    durationMonths: 1,
    color: "slate",
  },
  {
    id: "school",
    title: "School Fees",
    subtitle: "Plan ahead",
    apr: 12,
    durationMonths: 6,
    color: "blue",
  },
];
