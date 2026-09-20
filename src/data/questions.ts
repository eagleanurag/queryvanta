export type Difficulty = "Easy" | "Medium" | "Hard";

export type Question = {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  category: string;
  languages: string[];
  tags: string[];
  companies: string[];
  solved: boolean;
};

export const questions: Question[] = [
  {
    id: "high-engagement-video-filtering",
    title: "High-Engagement Video Filtering",
    description:
      "Filter recent videos with more than 1 million views and sort them by duration.",
    difficulty: "Easy",
    category: "Filtering",
    languages: ["PostgreSQL", "PySpark"],
    tags: ["WHERE", "FILTER", "ORDER BY"],
    companies: ["Netflix"],
    solved: false,
  },
];