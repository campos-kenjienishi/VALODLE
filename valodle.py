import random
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
import os
import sys
from agents_db import AGENTS

def resource_path(relative_path):
    """ Get the absolute path to the resource. """
    try:
        base_path = sys._MEIPASS  
    except AttributeError:
        base_path = os.path.abspath(".")  
    return os.path.join(base_path, relative_path)


class ValodleApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Valodle")
        self.root.state("zoomed")  # Fullscreen but windowed mode
        self.streak = 0
        self.initialize_game()

    def initialize_game(self):
        self.character = random.choice(AGENTS)
        self.attempts = 5

        for widget in self.root.winfo_children():
            widget.destroy()

        self.setup_layout()

    def setup_layout(self):
        # Title Image
        self.title_label = tk.Label(self.root)
        self.title_label.pack(pady=10)
        self.display_title()

        # Guess Input Section
        input_frame = tk.Frame(self.root)
        input_frame.pack(pady=10)

        prompt_label = tk.Label(input_frame, text="Guess the agent:", font=("Arial", 16))
        prompt_label.pack(side="left", padx=10)

        self.entry = tk.Entry(input_frame, font=("Arial", 16))
        self.entry.pack(side="left", padx=10)

        self.submit_button = tk.Button(input_frame, text="Submit", font=("Arial", 14), command=self.check_guess, relief="raised", bd=3)
        self.submit_button.pack(side="left", padx=10)

        # Main Frame for Hints and Reveal
        main_frame = tk.Frame(self.root)
        main_frame.pack(fill="both", expand=True, padx=20, pady=20)

        # Hints Section
        hints_frame = tk.Frame(main_frame, bd=5, relief="groove", bg="lightgray", width=400, height=500)
        hints_frame.pack_propagate(False)
        hints_frame.pack(side="left", fill="both", expand=False, padx=10, pady=10)

        hints_title = tk.Label(hints_frame, text="Hints", font=("Arial", 18, "bold"), bg="lightgray")
        hints_title.pack(pady=10)

        # Legend
        legend_frame = tk.Frame(hints_frame, bg="lightgray")
        legend_frame.pack(pady=10)

        legend_match = tk.Label(legend_frame, text="Match", fg="green", font=("Arial", 12), bg="lightgray")
        legend_match.pack(side="left", padx=10)
        legend_partial = tk.Label(legend_frame, text="Partial Match", fg="orange", font=("Arial", 12), bg="lightgray")
        legend_partial.pack(side="left", padx=10)
        legend_nomatch = tk.Label(legend_frame, text="No Match", fg="red", font=("Arial", 12), bg="lightgray")
        legend_nomatch.pack(side="left", padx=10)

        self.feedback_labels = {}
        for attribute in ["Gender", "Specialty", "Role", "Nationality", "Color Palette"]:
            label = tk.Label(hints_frame, text=f"{attribute}: ", font=("Arial", 14), bg="lightgray", anchor="w")
            label.pack(fill="x", padx=10, pady=5)
            self.feedback_labels[attribute] = label

        # Buttons Section
        button_frame = tk.Frame(hints_frame, bg="lightgray")
        button_frame.pack(side="bottom", pady=20)

        self.continue_button = tk.Button(button_frame, text="Continue", font=("Arial", 14), state="disabled", command=self.initialize_game, relief="raised", bd=3)
        self.continue_button.pack(side="left", padx=10)

        exit_button = tk.Button(button_frame, text="Exit", font=("Arial", 14), command=self.root.destroy, relief="raised", bd=3)
        exit_button.pack(side="left", padx=10)

        # Reveal Section
        reveal_frame = tk.Frame(main_frame, bd=5, relief="groove", bg="white", width=400, height=500)
        reveal_frame.pack_propagate(False)
        reveal_frame.pack(side="right", fill="both", expand=False, padx=10, pady=10)

        streak_label = tk.Label(reveal_frame, text=f"Streak: {self.streak}", font=("Arial", 16, "bold"), bg="white")
        streak_label.pack(pady=10)

        self.reveal_label = tk.Label(reveal_frame, text="", font=("Arial", 16), bg="white")
        self.reveal_label.pack(pady=10)

        self.reveal_image_label = tk.Label(reveal_frame, bg="white")
        self.reveal_image_label.pack(pady=10)

        # Valorant Logo
        self.logo_label = tk.Label(main_frame)
        self.logo_label.place(relx=0.5, rely=0.5, anchor="center")
        self.display_logo()

    def display_title(self):
        try:
            img = Image.open(resource_path("icons/valodletitle.png"))
            frame_size = 20
            img_with_frame = Image.new("RGBA", (img.width + 2 * frame_size, img.height + 2 * frame_size), "white")
            img_with_frame.paste(img, (frame_size, frame_size))
            border_size = 5
            img_with_border = Image.new("RGBA", (img_with_frame.width + 2 * border_size, img_with_frame.height + 2 * border_size), "black")
            img_with_border.paste(img_with_frame, (border_size, border_size))
            img_with_border = img_with_border.resize((600, 150), Image.Resampling.LANCZOS)
            img = ImageTk.PhotoImage(img_with_border)
            self.title_label.config(image=img, bg=self.root.cget("bg"), borderwidth=0, highlightthickness=0)
            self.title_label.image = img
        except Exception as e:
            self.title_label.config(text=f"Error loading title: {e}", fg="red")

    def display_logo(self):
        try:
            img = Image.open(resource_path("icons/valorantlogo.png"))
            img = img.resize((300, 300), Image.Resampling.LANCZOS)
            img = ImageTk.PhotoImage(img)
            self.logo_label.config(image=img, bg=self.root.cget("bg"))
            self.logo_label.image = img
        except Exception as e:
            self.logo_label.config(text=f"Error loading logo: {e}", fg="red")

    def check_guess(self):
        guess = self.entry.get().strip()
        guessed_character = next((c for c in AGENTS if c['name'].lower() == guess.lower()), None)

        if not guessed_character:
            messagebox.showerror("Error", "Agent not recognized. Try again.")
            return

        if guessed_character['name'].lower() == self.character['name'].lower():
            self.streak += 1
            self.reveal_correct()
            return

        self.attempts -= 1
        self.update_feedback(guessed_character)

        if self.attempts == 0:
            self.streak = 0
            self.reveal_incorrect()

    def reveal_correct(self):
        self.reveal_label.config(text=f"You guessed it! The agent is {self.character['name']}", fg="green")
        self.display_image()
        self.submit_button.config(state="disabled")
        self.continue_button.config(state="normal")

        for attribute, label in self.feedback_labels.items():
            actual_value = self.character[attribute.lower().replace(' ', '_')]
            label.config(text=f"{attribute}: {actual_value}", fg="green")

    def reveal_incorrect(self):
        self.reveal_label.config(text=f"Out of attempts! The agent was {self.character['name']}", fg="red")
        self.display_image()
        self.submit_button.config(state="disabled")
        self.continue_button.config(state="normal")

        for attribute, label in self.feedback_labels.items():
            actual_value = self.character[attribute.lower().replace(' ', '_')]
            label.config(text=f"{attribute}: {actual_value}", fg="red")

    def update_feedback(self, guessed_character):
        for attribute, label in self.feedback_labels.items():
            actual_value = self.character[attribute.lower().replace(' ', '_')]
            guessed_value = guessed_character[attribute.lower().replace(' ', '_')]
            if guessed_value == actual_value:
                label.config(text=f"{attribute}: {actual_value}", fg="green")
            elif attribute == "Specialty" and any(specialty in actual_value for specialty in guessed_value.split(", ")):
                label.config(text=f"{attribute}: {guessed_value}", fg="orange")
            elif attribute == "Color Palette" and any(color in actual_value for color in guessed_value.split(" and ")):
                label.config(text=f"{attribute}: {guessed_value}", fg="orange")
            else:
                label.config(text=f"{attribute}: {guessed_value}", fg="red")

    def display_image(self):
        try:
            img = Image.open(resource_path(self.character['image']))
            img = img.resize((300, 300), Image.Resampling.LANCZOS)
            img = ImageTk.PhotoImage(img)
            self.reveal_image_label.config(image=img)
            self.reveal_image_label.image = img
        except Exception as e:
            self.reveal_label.config(text=f"Error loading image: {e}", fg="red")

if __name__ == "__main__":
    root = tk.Tk()
    app = ValodleApp(root)
    root.mainloop()
